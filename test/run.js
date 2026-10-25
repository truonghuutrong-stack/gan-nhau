'use strict';
/**
 * Kiểm thử máy chủ: chạy bằng `npm test`.
 * Khởi động máy chủ trên một cổng ngẫu nhiên rồi giả lập nhiều thành viên.
 */
const assert = require('assert/strict');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = 'http://127.0.0.1:' + PORT;
let child = null;

function startServer() {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT), HOST: '127.0.0.1', GHOST_AFTER_SECONDS: '2' }),
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    child.stdout.on('data', (d) => {
      if (String(d).includes('đang chạy')) resolve();
    });
    child.on('error', reject);
    setTimeout(() => reject(new Error('Máy chủ không khởi động được')), 5000).unref();
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });
}

const hex = (n) => crypto.randomBytes(n).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(route, body, headers) {
  const res = await fetch(BASE + '/api/' + route, {
    method: 'POST',
    headers: Object.assign({ 'content-type': 'application/json' }, headers || {}),
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* 204 */
  }
  return { status: res.status, data };
}

function person(name) {
  return { name, id: hex(8), token: hex(16) };
}

/** Mở luồng SSE và gom các sự kiện. */
async function openStream(code, who) {
  const ctrl = new AbortController();
  const res = await fetch(BASE + '/api/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, id: who.id, token: who.token }),
    signal: ctrl.signal,
  });
  const s = { status: res.status, events: [], ended: false, ctrl };
  if (res.status !== 200) return s;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let ev = 'message';
          let data = '';
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) ev = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
          }
          if (data) s.events.push({ ev, data: JSON.parse(data) });
        }
      }
    } catch (_) {
      /* bị huỷ */
    }
    s.ended = true;
  })();
  s.waitFor = async (pred, ms) => {
    const end = Date.now() + (ms || 2000);
    while (Date.now() < end) {
      const hit = s.events.find(pred);
      if (hit) return hit;
      await sleep(20);
    }
    throw new Error('Hết thời gian chờ sự kiện. Đã nhận: ' + JSON.stringify(s.events.map((e) => e.ev)));
  };
  s.close = () => ctrl.abort();
  return s;
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    console.log('  LỖI  ' + name + '\n       ' + (err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}

(async () => {
  await startServer();
  console.log('Máy chủ thử nghiệm trên cổng ' + PORT);

  const A = person('Mẹ');
  const B = person('<b>Bố</b>');
  let code;

  await test('healthz và tệp tĩnh', async () => {
    const r = await fetch(BASE + '/healthz');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), 'ok');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  });

  await test('không đọc được tệp ngoài thư mục public', async () => {
    for (const p of ['/..%2fserver.js', '/%2e%2e/server.js', '/..%5cserver.js', '/../package.json', '/server.js']) {
      const r = await fetch(BASE + p);
      assert.ok(r.status === 404 || r.status === 403 || r.status === 400, p + ' trả về ' + r.status);
      const t = await r.text();
      assert.ok(!t.includes('createServer'), p + ' làm lộ mã nguồn');
    }
  });

  await test('API chỉ nhận POST và JSON', async () => {
    let r = await fetch(BASE + '/api/create');
    assert.equal(r.status, 405);
    r = await fetch(BASE + '/api/create', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(r.status, 415);
    r = await post('khong-co', {});
    assert.equal(r.status, 404);
    r = await post('constructor', {});
    assert.equal(r.status, 404);
    r = await fetch(BASE + '/api/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{hỏng' });
    assert.equal(r.status, 400);
  });

  await test('tạo nhóm', async () => {
    const r = await post('create', A);
    assert.equal(r.status, 200);
    code = r.data.code;
    assert.match(code, /^[A-HJ-KM-NP-Z2-9]{8}$/);
    assert.equal(r.data.members.length, 1);
    assert.equal(r.data.you.id, A.id);
    assert.equal(r.data.you.sharing, false);
    assert.ok(r.data.you.c >= 0 && r.data.you.c < 8);
    assert.equal(JSON.stringify(r.data).includes(A.token), false, 'không được trả token');
  });

  await test('tên được làm sạch, mã sai bị từ chối', async () => {
    let r = await post('join', Object.assign({ code: 'ZZZZZZZ' }, B));
    assert.equal(r.status, 400);
    r = await post('join', Object.assign({ code: 'ABCDEFGH' }, B));
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'no_group');
    r = await post('join', { code, id: 'xyz', token: 'abc', name: 'X' });
    assert.equal(r.status, 400);
    r = await post('join', Object.assign({ code, name: '   ' }, { id: B.id, token: B.token }));
    assert.equal(r.status, 400);
    r = await post('join', Object.assign({ code: code.toLowerCase() }, B));
    assert.equal(r.status, 200);
    assert.equal(r.data.members.length, 2);
    const me = r.data.members.find((m) => m.id === B.id);
    assert.ok(me.name.length > 0 && me.name.length <= 20);
    assert.ok(!me.name.includes('<') && !me.name.includes('>'), 'tên không được chứa dấu < >');
    assert.notEqual(me.c, r.data.members.find((m) => m.id === A.id).c, 'mỗi người một màu');
  });

  await test('thành viên khác không mạo danh được', async () => {
    let r = await post('pos', { code, id: B.id, token: hex(16), lat: 10, lng: 106 });
    assert.equal(r.status, 403);
    r = await post('pos', { code, id: hex(8), token: B.token, lat: 10, lng: 106 });
    assert.equal(r.status, 404);
    assert.equal(r.data.error, 'no_member');
    r = await post('join', { code, id: B.id, token: hex(16), name: 'Kẻ lạ' });
    assert.equal(r.status, 403);
  });

  const sa = await openStream(code, A);
  const sb = await openStream(code, B);

  await test('luồng sự kiện gửi ảnh chụp ban đầu', async () => {
    assert.equal(sa.status, 200);
    const hello = await sa.waitFor((e) => e.ev === 'hello');
    assert.equal(hello.data.members.length, 2);
    assert.ok(Math.abs(hello.data.now - Date.now()) < 5000);
    const bad = await openStream(code, { id: B.id, token: hex(16) });
    assert.equal(bad.status, 403);
    const none = await openStream('ABCDEFGH', B);
    assert.equal(none.status, 404);
  });

  await test('vị trí của B đến được A, giá trị sai bị từ chối', async () => {
    let r = await post('pos', { code, id: B.id, token: B.token, lat: 10.7769, lng: 106.7009, acc: 12.4, spd: 8.33, hdg: 91 });
    assert.equal(r.status, 204);
    const ev = await sa.waitFor((e) => e.ev === 'member' && e.data.id === B.id && e.data.pos);
    assert.equal(ev.data.pos.lat, 10.7769);
    assert.equal(ev.data.pos.acc, 12);
    assert.equal(ev.data.sharing, true);
    await sleep(750);
    r = await post('pos', { code, id: B.id, token: B.token, lat: 91, lng: 106 });
    assert.equal(r.status, 400);
    r = await post('pos', { code, id: B.id, token: B.token, lat: '10', lng: 106 });
    assert.equal(r.status, 400);
  });

  await test('gửi dồn dập bị bỏ qua', async () => {
    await sleep(750);
    const before = sa.events.length;
    await post('pos', { code, id: B.id, token: B.token, lat: 10.78, lng: 106.7 });
    await post('pos', { code, id: B.id, token: B.token, lat: 10.79, lng: 106.7 });
    await sleep(150);
    const got = sa.events.slice(before).filter((e) => e.ev === 'member');
    assert.equal(got.length, 1);
    assert.equal(got[0].data.pos.lat, 10.78);
  });

  await test('tạm dừng chia sẻ xoá vị trí cũ', async () => {
    const r = await post('share', { code, id: B.id, token: B.token, on: false });
    assert.equal(r.status, 204);
    const ev = await sa.waitFor((e) => e.ev === 'member' && e.data.id === B.id && e.data.sharing === false);
    assert.equal(ev.data.pos, null);
  });

  await test('điểm hẹn đặt và xoá', async () => {
    let r = await post('rally', { code, id: A.id, token: A.token, lat: 10.5, lng: 107.1, label: '  Trạm dừng chân  ' });
    assert.equal(r.status, 204);
    const ev = await sb.waitFor((e) => e.ev === 'rally' && e.data.rally);
    assert.equal(ev.data.rally.label, 'Trạm dừng chân');
    assert.equal(ev.data.rally.by, A.id);
    r = await post('rally', { code, id: A.id, token: A.token, lat: 200, lng: 0 });
    assert.equal(r.status, 400);
    await post('rally', { code, id: B.id, token: B.token, clear: true });
    await sb.waitFor((e) => e.ev === 'rally' && e.data.rally === null);
  });

  await test('không xoá được người đang trực tuyến', async () => {
    const r = await post('kick', { code, id: A.id, token: A.token, target: B.id });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, 'still_online');
  });

  await test('rời nhóm báo cho người còn lại', async () => {
    const r = await post('leave', { code, id: A.id, token: A.token });
    assert.equal(r.status, 204);
    await sb.waitFor((e) => e.ev === 'gone' && e.data.id === A.id);
    await sleep(50);
    assert.equal(sa.ended, true, 'luồng của người rời nhóm phải đóng');
  });

  await test('máy chủ khởi động lại thì khôi phục nhóm theo mã cũ', async () => {
    await stopServer();
    await sleep(100);
    assert.equal(sb.ended, true, 'luồng phải kết thúc khi máy chủ tắt');
    await startServer();
    let r = await post('join', Object.assign({ code }, B));
    assert.equal(r.status, 404, 'nhóm đã mất sau khi khởi động lại');
    r = await post('pos', { code, id: B.id, token: B.token, lat: 10, lng: 106 });
    assert.equal(r.status, 404);
    r = await post('join', Object.assign({ code, restore: true }, B));
    assert.equal(r.status, 200);
    assert.equal(r.data.code, code);
    assert.equal(r.data.members.length, 1);
    const A2 = A;
    r = await post('join', Object.assign({ code, restore: true }, A2));
    assert.equal(r.status, 200);
    assert.equal(r.data.members.length, 2);
  });

  await test('nhóm đầy và giới hạn tạo nhóm', async () => {
    const r0 = await post('create', person('Chủ'));
    const c = r0.data.code;
    for (let i = 0; i < 19; i++) {
      const r = await post('join', Object.assign({ code: c }, person('Người ' + i)));
      assert.equal(r.status, 200, 'người thứ ' + (i + 2));
    }
    const full = await post('join', Object.assign({ code: c }, person('Thừa')));
    assert.equal(full.status, 409);
    assert.equal(full.data.error, 'full');
  });

  await test('xoá người đã vắng mặt (ngưỡng thử nghiệm 2 giây)', async () => {
    const X = person('X');
    const Y = person('Y');
    const c = (await post('create', X)).data.code;
    await post('join', Object.assign({ code: c }, Y));
    const sx = await openStream(c, X);
    await sx.waitFor((e) => e.ev === 'hello');
    let r = await post('kick', { code: c, id: X.id, token: X.token, target: Y.id });
    assert.equal(r.status, 409, 'vừa mới vắng thì chưa được xoá');
    const self = await post('kick', { code: c, id: X.id, token: X.token, target: X.id });
    assert.equal(self.status, 400);
    await sleep(2300);
    r = await post('kick', { code: c, id: X.id, token: X.token, target: Y.id });
    assert.equal(r.status, 204);
    await sx.waitFor((e) => e.ev === 'gone' && e.data.id === Y.id);
    // Y quay lại thì tự vào lại được bằng thông tin đã lưu trên máy
    r = await post('join', Object.assign({ code: c, restore: true }, Y));
    assert.equal(r.status, 200);
    assert.equal(r.data.members.length, 2);
    sx.close();
  });

  await stopServer();
  console.log('\n' + passed + ' kiểm thử đạt' + (process.exitCode ? ', CÓ LỖI' : ''));
})().catch(async (e) => {
  console.error(e);
  await stopServer();
  process.exit(1);
});
