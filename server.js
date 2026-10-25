'use strict';
/**
 * Gần Nhau — máy chủ chia sẻ vị trí theo nhóm.
 *
 * - Không cần cài thư viện ngoài, chỉ cần Node.js 18 trở lên.
 * - Vị trí chỉ nằm trong bộ nhớ, không ghi ra đĩa, không ghi log.
 * - Nhóm tự xoá sau GROUP_TTL_HOURS giờ không hoạt động.
 *
 * Biến môi trường (đều không bắt buộc):
 *   PORT              cổng lắng nghe (mặc định 3000)
 *   HOST              địa chỉ lắng nghe (mặc định 0.0.0.0)
 *   GROUP_TTL_HOURS   số giờ giữ nhóm khi không ai hoạt động (mặc định 24)
 *   MAX_GROUPS        số nhóm tối đa cùng lúc (mặc định 300)
 *   MAX_MEMBERS       số người tối đa mỗi nhóm (mặc định 20)
 *   CREATE_PER_HOUR   số lần tạo nhóm tối đa mỗi giờ cho mỗi địa chỉ IP (mặc định 20)
 *   GHOST_AFTER_SECONDS  sau bao nhiêu giây vắng mặt thì người khác được xoá một thành viên (mặc định 180)
 *   TRUST_PROXY       đặt 0 nếu máy chủ nhận kết nối trực tiếp, không qua proxy
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const TRUST_PROXY = process.env.TRUST_PROXY !== '0';
const GROUP_TTL_MS = (parseFloat(process.env.GROUP_TTL_HOURS) || 24) * 3600 * 1000;
const MAX_GROUPS = parseInt(process.env.MAX_GROUPS, 10) || 300;
const MAX_MEMBERS = parseInt(process.env.MAX_MEMBERS, 10) || 20;
const CREATE_PER_HOUR = parseInt(process.env.CREATE_PER_HOUR, 10) || 20;
const PUBLIC_DIR = path.join(__dirname, 'public');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // bỏ I, L, O, 0, 1 cho dễ đọc
const CODE_LEN = 8;
const COLOR_COUNT = 8;
const SSE_PING_MS = 15000;
// Vắng mặt quá 3 phút (mặc định) thì người khác mới được xoá khỏi nhóm
const GHOST_AFTER_MS = (parseFloat(process.env.GHOST_AFTER_SECONDS) || 180) * 1000;
const MIN_POS_GAP_MS = 700;

const RE_CODE = /^[A-Z0-9]{8}$/;
const RE_ID = /^[a-f0-9]{16}$/;
const RE_TOKEN = /^[a-f0-9]{32}$/;

/** code -> { code, createdAt, lastActive, members: Map, clients: Set, rally } */
const groups = new Map();

// ---------------------------------------------------------------- tiện ích

function httpError(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

function genCode() {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest();
}

function sameToken(member, token) {
  const h = hashToken(token);
  return h.length === member.tokenHash.length && crypto.timingSafeEqual(h, member.tokenHash);
}

function cleanText(s, max) {
  const t = String(s == null ? '' : s)
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(t).slice(0, max).join('');
}

function num(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function round(v, digits) {
  const k = Math.pow(10, digits);
  return Math.round(v * k) / k;
}

function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim() || 'unknown';
  }
  return req.socket.remoteAddress || 'unknown';
}

// Giới hạn tần suất đơn giản, tính theo bộ nhớ
const buckets = new Map();
function bucket(key, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { n: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  return b;
}
function allow(key, limit, windowMs) {
  const b = bucket(key, windowMs);
  if (b.n >= limit) return false;
  b.n++;
  return true;
}
const FAIL_LIMIT = 30;
const FAIL_WINDOW = 10 * 60 * 1000;
function isBlocked(ip) {
  return bucket('fail:' + ip, FAIL_WINDOW).n >= FAIL_LIMIT;
}
function noteFailure(ip) {
  bucket('fail:' + ip, FAIL_WINDOW).n++;
}

// ---------------------------------------------------------------- nhóm

function newGroup(code) {
  const now = Date.now();
  return { code, createdAt: now, lastActive: now, members: new Map(), clients: new Set(), rally: null };
}

function addMember(g, ident, wantColor) {
  const used = new Set();
  for (const m of g.members.values()) used.add(m.color);
  let color = -1;
  if (Number.isInteger(wantColor) && wantColor >= 0 && wantColor < COLOR_COUNT && !used.has(wantColor)) color = wantColor;
  if (color < 0) {
    for (let i = 0; i < COLOR_COUNT; i++) {
      if (!used.has(i)) {
        color = i;
        break;
      }
    }
  }
  if (color < 0) color = g.members.size % COLOR_COUNT;
  const now = Date.now();
  const m = {
    id: ident.id,
    name: ident.name,
    color,
    tokenHash: hashToken(ident.token),
    sharing: false,
    pos: null,
    joinedAt: now,
    lastSeen: now,
    lastPosAt: 0,
    conns: 0,
  };
  g.members.set(m.id, m);
  return m;
}

function pub(m) {
  return { id: m.id, name: m.name, c: m.color, sharing: m.sharing, pos: m.pos };
}

function snapshot(g, me) {
  return {
    code: g.code,
    you: pub(me),
    members: Array.from(g.members.values()).map(pub),
    rally: g.rally,
    now: Date.now(),
  };
}

function touch(g, m) {
  const now = Date.now();
  g.lastActive = now;
  if (m) m.lastSeen = now;
}

function sseFrame(ev, data) {
  return 'event: ' + ev + '\ndata: ' + JSON.stringify(data) + '\n\n';
}

function broadcast(g, ev, data) {
  const frame = sseFrame(ev, data);
  for (const c of g.clients) {
    try {
      if (c.res.writableLength > 256 * 1024) {
        c.res.destroy(); // máy khách quá chậm
        continue;
      }
      c.res.write(frame);
    } catch (_) {
      /* bỏ qua */
    }
  }
}

function removeMember(g, m) {
  g.members.delete(m.id);
  broadcast(g, 'gone', { id: m.id });
  for (const c of Array.from(g.clients)) {
    if (c.id === m.id) {
      try {
        c.res.end();
      } catch (_) {
        /* bỏ qua */
      }
    }
  }
  if (g.members.size === 0) groups.delete(g.code);
}

// ---------------------------------------------------------------- phản hồi HTTP

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://tile.openstreetmap.org",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  res.setHeader('Content-Security-Policy', CSP);
}

function sendJson(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(
    status,
    Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      },
      headers || {}
    )
  );
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function noContent(res) {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

function readJson(req, limit) {
  limit = limit || 4096;
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit * 16) {
        req.destroy();
        return;
      }
      if (size > limit) {
        tooLarge = true;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) return reject(httpError(413, 'too_large'));
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        const obj = text ? JSON.parse(text) : {};
        if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('shape');
        resolve(obj);
      } catch (_) {
        reject(httpError(400, 'bad_json'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------- API

function readIdentity(b) {
  const id = String(b.id || '');
  const token = String(b.token || '');
  const name = cleanText(b.name, 20);
  if (!RE_ID.test(id) || !RE_TOKEN.test(token)) throw httpError(400, 'bad_identity');
  if (!name) throw httpError(400, 'bad_name');
  return { id, token, name };
}

/** Kiểm tra thành viên; gửi lỗi và trả về null nếu không hợp lệ. */
function authed(b, res) {
  const code = String(b.code || '').toUpperCase();
  const g = RE_CODE.test(code) ? groups.get(code) : null;
  if (!g) {
    sendJson(res, 404, { error: 'no_group' });
    return null;
  }
  const m = g.members.get(String(b.id || ''));
  if (!m) {
    sendJson(res, 404, { error: 'no_member' });
    return null;
  }
  if (!sameToken(m, String(b.token || ''))) {
    sendJson(res, 403, { error: 'forbidden' });
    return null;
  }
  return { g, m };
}

const ROUTES = {
  create(req, res, b) {
    const ip = clientIp(req);
    if (!allow('create:' + ip, CREATE_PER_HOUR, 3600 * 1000)) return sendJson(res, 429, { error: 'rate_limited' });
    const ident = readIdentity(b);
    if (groups.size >= MAX_GROUPS) return sendJson(res, 503, { error: 'busy' });
    let code;
    do {
      code = genCode();
    } while (groups.has(code));
    const g = newGroup(code);
    groups.set(code, g);
    const m = addMember(g, ident, b.color);
    sendJson(res, 200, snapshot(g, m));
  },

  join(req, res, b) {
    const ip = clientIp(req);
    if (isBlocked(ip)) return sendJson(res, 429, { error: 'rate_limited' });
    const code = String(b.code || '').toUpperCase();
    if (!RE_CODE.test(code)) {
      noteFailure(ip);
      return sendJson(res, 400, { error: 'bad_code' });
    }
    const ident = readIdentity(b);
    let g = groups.get(code);
    if (!g) {
      if (!b.restore) {
        noteFailure(ip);
        return sendJson(res, 404, { error: 'no_group' });
      }
      // Máy chủ vừa khởi động lại: dựng lại nhóm cũ theo mã mà thành viên đang giữ
      if (!allow('create:' + ip, CREATE_PER_HOUR, 3600 * 1000)) return sendJson(res, 429, { error: 'rate_limited' });
      if (groups.size >= MAX_GROUPS) return sendJson(res, 503, { error: 'busy' });
      g = newGroup(code);
      groups.set(code, g);
    }
    let m = g.members.get(ident.id);
    if (m) {
      if (!sameToken(m, ident.token)) return sendJson(res, 403, { error: 'forbidden' });
      m.name = ident.name;
    } else {
      if (g.members.size >= MAX_MEMBERS) return sendJson(res, 409, { error: 'full' });
      m = addMember(g, ident, b.color);
    }
    touch(g, m);
    broadcast(g, 'member', pub(m));
    sendJson(res, 200, snapshot(g, m));
  },

  stream(req, res, b) {
    const a = authed(b, res);
    if (!a) return;
    const { g, m } = a;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    if (res.socket) {
      res.socket.setTimeout(0);
      res.socket.setNoDelay(true);
      res.socket.setKeepAlive(true, 30000);
    }
    const client = { res, id: m.id };
    g.clients.add(client);
    m.conns++;
    touch(g, m);
    res.write('retry: 3000\n\n');
    res.write(sseFrame('hello', snapshot(g, m)));
    res.on('close', () => {
      if (!g.clients.delete(client)) return;
      m.conns = Math.max(0, m.conns - 1);
      m.lastSeen = Date.now();
    });
  },

  pos(req, res, b) {
    const a = authed(b, res);
    if (!a) return;
    const { g, m } = a;
    const now = Date.now();
    if (now - m.lastPosAt < MIN_POS_GAP_MS) return noContent(res);
    const lat = num(b.lat, -90, 90);
    const lng = num(b.lng, -180, 180);
    if (lat == null || lng == null) return sendJson(res, 400, { error: 'bad_position' });
    const acc = num(b.acc, 0, 100000);
    const spd = num(b.spd, 0, 200);
    const hdg = num(b.hdg, 0, 360);
    m.pos = {
      lat: round(lat, 6),
      lng: round(lng, 6),
      acc: acc == null ? null : Math.round(acc),
      spd: spd == null ? null : round(spd, 1),
      hdg: hdg == null ? null : Math.round(hdg),
      t: now,
    };
    m.sharing = true;
    m.lastPosAt = now;
    touch(g, m);
    broadcast(g, 'member', pub(m));
    noContent(res);
  },

  share(req, res, b) {
    const a = authed(b, res);
    if (!a) return;
    const { g, m } = a;
    m.sharing = b.on === true;
    if (!m.sharing) m.pos = null; // tạm dừng thì không để lại vị trí cũ
    touch(g, m);
    broadcast(g, 'member', pub(m));
    noContent(res);
  },

  rally(req, res, b) {
    const a = authed(b, res);
    if (!a) return;
    const { g, m } = a;
    if (b.clear === true) {
      g.rally = null;
    } else {
      const lat = num(b.lat, -90, 90);
      const lng = num(b.lng, -180, 180);
      if (lat == null || lng == null) return sendJson(res, 400, { error: 'bad_position' });
      g.rally = {
        lat: round(lat, 6),
        lng: round(lng, 6),
        label: cleanText(b.label, 40) || 'Điểm hẹn',
        by: m.id,
        byName: m.name,
        at: Date.now(),
      };
    }
    touch(g, m);
    broadcast(g, 'rally', { rally: g.rally });
    noContent(res);
  },

  leave(req, res, b) {
    const a = authed(b, res);
    if (!a) return;
    removeMember(a.g, a.m);
    noContent(res);
  },

  kick(req, res, b) {
    const a = authed(b, res);
    if (!a) return;
    const { g, m } = a;
    const target = g.members.get(String(b.target || ''));
    if (!target) return sendJson(res, 404, { error: 'no_member' });
    if (target.id === m.id) return sendJson(res, 400, { error: 'bad_request' });
    // Chỉ được xoá người đã mất kết nối một lúc, để không ai bị đuổi khi đang dùng
    if (target.conns > 0 || Date.now() - target.lastSeen < GHOST_AFTER_MS) {
      return sendJson(res, 409, { error: 'still_online' });
    }
    touch(g, m);
    removeMember(g, target);
    noContent(res);
  },
};

async function handleApi(req, res, url) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' });
  const name = url.pathname.slice(5);
  const fn = Object.prototype.hasOwnProperty.call(ROUTES, name) ? ROUTES[name] : null;
  if (!fn) return sendJson(res, 404, { error: 'not_found' });
  const ct = String(req.headers['content-type'] || '');
  if (ct.indexOf('application/json') !== 0) return sendJson(res, 415, { error: 'unsupported_media_type' });
  const body = await readJson(req);
  return fn(req, res, body);
}

// ---------------------------------------------------------------- tệp tĩnh

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt']);
const fileCache = new Map();

function loadFile(abs, st, ext) {
  let c = fileCache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c;
  const raw = fs.readFileSync(abs);
  c = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    etag: 'W/"' + st.size + '-' + Math.floor(st.mtimeMs) + '"',
    raw,
    gzip: COMPRESSIBLE.has(ext) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null,
  };
  fileCache.set(abs, c);
  return c;
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method Not Allowed');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch (_) {
    return sendText(res, 400, 'Bad Request');
  }
  if (rel.indexOf('\0') !== -1) return sendText(res, 400, 'Bad Request');
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = path.join(PUBLIC_DIR, path.normalize(rel));
  if (abs !== PUBLIC_DIR && abs.indexOf(PUBLIC_DIR + path.sep) !== 0) return sendText(res, 403, 'Forbidden');
  let st;
  try {
    st = fs.statSync(abs);
  } catch (_) {
    return sendText(res, 404, 'Không tìm thấy trang này');
  }
  if (!st.isFile()) return sendText(res, 404, 'Không tìm thấy trang này');
  const ext = path.extname(abs).toLowerCase();
  const file = loadFile(abs, st, ext);
  const longCache = /^\/(vendor|fonts|icons)\//.test(rel);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': longCache ? 'public, max-age=604800' : 'no-cache',
    ETag: file.etag,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === file.etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  let body = file.raw;
  if (file.gzip && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    body = file.gzip;
    headers['Content-Encoding'] = 'gzip';
  }
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  res.end(body);
}

// ---------------------------------------------------------------- máy chủ

const server = http.createServer(async (req, res) => {
  try {
    setSecurityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.indexOf('/api/') === 0) return await handleApi(req, res, url);
    if (url.pathname === '/healthz') return sendText(res, 200, 'ok');
    return serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.code || 'server_error' });
    else res.end();
  }
});
server.keepAliveTimeout = 65 * 1000;
server.headersTimeout = 66 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [code, g] of groups) {
    if (g.clients.size === 0 && now - g.lastActive > GROUP_TTL_MS) groups.delete(code);
  }
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60 * 1000).unref();

setInterval(() => {
  for (const g of groups.values()) {
    for (const c of g.clients) {
      try {
        c.res.write(': ping\n\n');
      } catch (_) {
        /* bỏ qua */
      }
    }
  }
}, SSE_PING_MS).unref();

function shutdown() {
  server.close();
  for (const g of groups.values()) {
    for (const c of g.clients) {
      try {
        c.res.end();
      } catch (_) {
        /* bỏ qua */
      }
    }
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log('Gần Nhau đang chạy tại http://localhost:' + PORT);
  });
}

module.exports = { server, groups };
