/* Gần Nhau — phần chạy trên trình duyệt. Không cần bước biên dịch. */
(function () {
  'use strict';

  var GN = window.GN;
  var L = window.L;

  // ---------------------------------------------------------------- hằng số

  var SESSION_KEY = 'gannhau.session.v1';
  var SETTINGS_KEY = 'gannhau.settings.v1';
  var NAME_KEY = 'gannhau.name.v1';
  var SHARE_KEY = 'gannhau.share.v1';

  var SEND_MIN_GAP = 3000; // gửi vị trí tối đa 3 giây một lần khi đang di chuyển
  var SEND_MIN_MOVE = 8; // và chỉ khi đã di chuyển ít nhất 8 m
  var SEND_HEARTBEAT = 20000; // đứng yên vẫn báo "tôi còn đây" mỗi 20 giây
  var LOST_MS = 180000; // quá 3 phút không có tín hiệu thì coi là mất tín hiệu
  var VN_CENTER = [16.2, 106.2];
  var OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

  var UA = navigator.userAgent || '';
  var IS_IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var IN_APP = /Zalo|FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|MicroMessenger|KAKAOTALK/i.test(UA);
  var STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

  var ICONS = {
    locate: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/></svg>',
    fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
    nav: '<svg viewBox="0 0 24 24"><path d="M12 3l7 17-7-4-7 4z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/></svg>',
  };

  // ---------------------------------------------------------------- tiện ích chung

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) return kid.forEach(function (k) { append(el, k); });
    el.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }

  function icon(name) {
    var s = document.createElement('span');
    s.innerHTML = ICONS[name];
    return s.firstChild;
  }

  function lsGet(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  }
  function lsSet(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      /* chế độ riêng tư: bỏ qua */
    }
  }
  function lsDel(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      /* bỏ qua */
    }
  }

  function rndHex(bytes) {
    var a = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map
      .call(a, function (b) {
        return ('0' + b.toString(16)).slice(-2);
      })
      .join('');
  }

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }
  function noop() {}

  function cleanName(s) {
    return Array.from(String(s || '').replace(/[<>\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 20).join('');
  }

  // ---------------------------------------------------------------- trạng thái

  var S = {
    session: null, // {code, id, token, name, color}
    previous: null, // nhóm cũ, chỉ rời khi đã vào nhóm mới
    members: new Map(),
    rally: null,
    skew: 0,
    gen: 0, // tăng mỗi lần khởi động lại vòng kết nối
    conn: 'connecting', // connecting | online | offline
    offlineSince: 0,
    lastByteAt: 0,
    streamCtrl: null,
    helloAt: 0,

    sharing: false, // người dùng đã bật chia sẻ
    geo: 'idle', // idle | asking | searching | live | denied | unavailable | insecure
    me: null,
    watchId: null,
    lastSent: 0,
    lastSentPos: null,
    sending: false,
    pendingSend: false,
    wake: null,

    settings: { alertM: 0, keepAwake: true, sound: true },
    alerts: new Map(),
    armedAt: 0,

    map: null,
    markers: new Map(),
    rallyMarker: null,
    rows: new Map(),
    banners: new Map(),
    mode: 'all', // all | me | member | free
    followId: null,
    progUntil: 0,
    lastFit: 0,
    lastFollow: 0,
    lastFollowPos: null,
    didFirstFit: false,
    picking: false,
    sheetOpen: false,
    modal: null,
  };

  function serverNow() {
    return Date.now() + S.skew;
  }
  function myPos() {
    return S.sharing && S.me ? S.me : null;
  }
  function myId() {
    return S.session ? S.session.id : null;
  }

  // ---------------------------------------------------------------- thông báo nhỏ, hộp thoại

  var toastTimer = 0;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    if (isWide()) el.style.removeProperty('--toast-bottom');
    else el.style.setProperty('--toast-bottom', (S.session && !$('#mapscreen').hidden ? sheetVisibleHeight() + 16 : 140) + 'px');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('show');
    }, 2800);
  }

  function openModal(title, content, opts) {
    closeModal(true);
    var root = $('#modal-root');
    while (root.firstChild) root.removeChild(root.firstChild); // dọn hộp thoại cũ còn đang trượt xuống
    var back = h('div', {
      class: 'backdrop',
      onclick: function () {
        closeModal();
      },
    });
    var panel = h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabindex: '-1' },
      h('div', { class: 'modal-grip' }),
      h(
        'div',
        { class: 'modal-head' },
        h('h2', { text: title }),
        h(
          'button',
          {
            class: 'icon-btn',
            type: 'button',
            'aria-label': 'Đóng',
            onclick: function () {
              closeModal();
            },
          },
          icon('close')
        )
      ),
      content
    );
    root.appendChild(back);
    root.appendChild(panel);
    void root.offsetWidth;
    root.classList.add('open');
    S.modal = { onClose: opts && opts.onClose };
    try {
      panel.focus({ preventScroll: true });
    } catch (e) {
      /* bỏ qua */
    }
    return panel;
  }

  function closeModal(immediate) {
    if (!S.modal) return;
    var m = S.modal;
    S.modal = null;
    var root = $('#modal-root');
    var kids = Array.prototype.slice.call(root.children);
    root.classList.remove('open');
    if (immediate) {
      kids.forEach(function (k) {
        k.remove();
      });
    } else {
      setTimeout(function () {
        kids.forEach(function (k) {
          k.remove();
        });
      }, 330);
    }
    if (m.onClose) m.onClose();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (S.picking) stopPicking();
      closeModal();
    }
  });

  function copyText(text) {
    var done = function (ok) {
      return ok;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return Promise.resolve(done(fallbackCopy(text)));
  }
  function fallbackCopy(text) {
    var ok = false;
    var ta = h('textarea', { readonly: '', 'aria-hidden': 'true', style: 'position:fixed;top:0;left:0;opacity:0;font-size:16px' });
    ta.value = text;
    document.body.appendChild(ta);
    try {
      ta.select();
      ta.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    ta.remove();
    return ok;
  }

  // ---------------------------------------------------------------- lưu trữ trên máy

  function loadSession() {
    var s = lsGet(SESSION_KEY);
    if (s && /^[A-Z0-9]{8}$/.test(s.code || '') && /^[a-f0-9]{16}$/.test(s.id || '') && /^[a-f0-9]{32}$/.test(s.token || '')) return s;
    return null;
  }
  function saveSession() {
    lsSet(SESSION_KEY, S.session);
  }
  function loadSettings() {
    var s = lsGet(SETTINGS_KEY);
    if (s && typeof s === 'object') {
      if (typeof s.alertM === 'number') S.settings.alertM = s.alertM;
      if (typeof s.keepAwake === 'boolean') S.settings.keepAwake = s.keepAwake;
      if (typeof s.sound === 'boolean') S.settings.sound = s.sound;
    }
  }
  function saveSettings() {
    lsSet(SETTINGS_KEY, S.settings);
  }

  // ---------------------------------------------------------------- gọi máy chủ

  function api(route, body) {
    return fetch('/api/' + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    }).then(function (res) {
      if (res.status === 204) return null;
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (data) {
          if (!res.ok) {
            var e = new Error((data && data.error) || String(res.status));
            e.status = res.status;
            e.code = data && data.error;
            throw e;
          }
          return data;
        });
    });
  }

  function auth(extra) {
    var o = { code: S.session.code, id: S.session.id, token: S.session.token };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }

  function errText(e) {
    var c = e && (e.code || e.status);
    switch (c) {
      case 'no_group':
        return 'Không tìm thấy nhóm này. Kiểm tra lại mã nhé.';
      case 'bad_code':
        return 'Mã nhóm gồm 8 ký tự, ví dụ ABCD-EFGH.';
      case 'bad_name':
        return 'Hãy nhập tên để mọi người nhận ra bạn.';
      case 'full':
        return 'Nhóm này đã đủ người.';
      case 'rate_limited':
        return 'Bạn thử quá nhiều lần. Chờ một lúc rồi thử lại.';
      case 'busy':
        return 'Máy chủ đang đầy. Thử lại sau ít phút.';
      case 'still_online':
        return 'Người này vẫn đang kết nối nên chưa xoá được.';
      default:
        return navigator.onLine === false ? 'Không có mạng. Kiểm tra kết nối rồi thử lại.' : 'Chưa kết nối được máy chủ. Thử lại sau nhé.';
    }
  }

  function applySnapshot(data) {
    S.skew = data.now - Date.now();
    S.members = new Map();
    data.members.forEach(function (m) {
      S.members.set(m.id, m);
    });
    S.rally = data.rally || null;
    if (S.session && data.you) {
      S.session.color = data.you.c;
      saveSession();
    }
  }

  // ---------------------------------------------------------------- vòng kết nối thời gian thực

  function setConn(state) {
    if (S.conn === state) return;
    S.conn = state;
    S.offlineSince = state === 'online' ? 0 : S.offlineSince || Date.now();
    scheduleRender();
  }

  function startRealtime() {
    stopRealtime();
    S.gen++;
    realtimeLoop(S.gen);
  }
  function stopRealtime() {
    S.gen++;
    if (S.streamCtrl) {
      try {
        S.streamCtrl.abort();
      } catch (e) {
        /* bỏ qua */
      }
      S.streamCtrl = null;
    }
  }

  async function realtimeLoop(gen) {
    var delay = 0;
    while (gen === S.gen && S.session) {
      if (delay) await sleep(delay);
      if (gen !== S.gen || !S.session) return;
      var ranFor = 0;
      try {
        if (S.conn !== 'online') setConn('connecting');
        var snap = await api('join', auth({ name: S.session.name, color: S.session.color, restore: true }));
        if (gen !== S.gen) return;
        applySnapshot(snap);
        S.armedAt = Date.now() + 6000;
        onJoined();
        ranFor = await readStream(gen);
        delay = ranFor > 10000 ? 800 : Math.min(15000, (delay || 800) * 2);
      } catch (e) {
        if (gen !== S.gen) return;
        if (e && e.status === 403) return fatal('Phiên của bạn không còn hợp lệ. Hãy vào lại nhóm.');
        if (e && e.status === 409) return fatal('Nhóm này đã đủ người nên chưa vào lại được.');
        delay = e && e.status === 404 ? 600 : Math.min(15000, (delay || 800) * 2);
      }
      if (gen === S.gen) setConn('offline');
    }
  }

  function onJoined() {
    // Sau khi (vào lại) nhóm, báo lại trạng thái chia sẻ vì máy chủ có thể vừa khởi động lại
    if (S.sharing && S.geo !== 'denied' && S.geo !== 'insecure' && S.geo !== 'unavailable') {
      api('share', auth({ on: true })).catch(noop);
      S.lastSentPos = null;
      if (S.me) maybeSend(true);
    }
  }

  async function readStream(gen) {
    var ctrl = new AbortController();
    S.streamCtrl = ctrl;
    var startedAt = Date.now();
    S.lastByteAt = startedAt;
    var dog = setInterval(function () {
      if (Date.now() - S.lastByteAt > 40000) ctrl.abort(); // máy chủ ping mỗi 15 giây; im quá 40 giây là mạng đã đứt
    }, 5000);
    try {
      var res = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(auth()),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        var err = new Error('stream ' + res.status);
        err.status = res.status;
        throw err;
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        S.lastByteAt = Date.now();
        buf += dec.decode(r.value, { stream: true });
        var i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          var raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (gen === S.gen) handleFrame(raw);
        }
      }
    } catch (e) {
      if (e && e.status && e.status >= 400 && e.status < 500) throw e;
      /* mạng đứt hoặc bị huỷ: vòng lặp sẽ kết nối lại */
    } finally {
      clearInterval(dog);
      if (S.streamCtrl === ctrl) S.streamCtrl = null;
    }
    return Date.now() - startedAt;
  }

  function handleFrame(raw) {
    var ev = 'message';
    var data = '';
    raw.split('\n').forEach(function (line) {
      if (line.charAt(0) === ':') return;
      if (line.indexOf('event:') === 0) ev = line.slice(6).trim();
      else if (line.indexOf('data:') === 0) data += line.slice(5).replace(/^ /, '');
    });
    if (!data) return;
    var obj;
    try {
      obj = JSON.parse(data);
    } catch (e) {
      return;
    }
    onServerEvent(ev, obj);
  }

  function onServerEvent(ev, d) {
    if (ev === 'hello') {
      applySnapshot(d);
      S.helloAt = Date.now();
      setConn('online');
    } else if (ev === 'member') {
      var isNew = !S.members.has(d.id);
      S.members.set(d.id, d);
      if (isNew && S.helloAt && d.id !== myId()) toast(d.name + ' vừa vào nhóm');
    } else if (ev === 'gone') {
      var gone = S.members.get(d.id);
      S.members.delete(d.id);
      if (d.id === myId()) return fatal('Bạn đã rời khỏi nhóm này.');
      if (gone) toast(gone.name + ' đã rời nhóm');
    } else if (ev === 'rally') {
      var prev = S.rally;
      S.rally = d.rally || null;
      if (S.rally && S.rally.by !== myId() && (!prev || prev.at !== S.rally.at)) toast(S.rally.byName + ' đặt điểm hẹn: ' + S.rally.label);
    }
    scheduleRender();
  }

  function checkStream() {
    if (!S.session) return;
    if (S.conn !== 'online' || Date.now() - S.lastByteAt > 25000) startRealtime();
  }

  window.addEventListener('online', function () {
    if (S.session) startRealtime();
  });
  window.addEventListener('offline', function () {
    if (S.session) setConn('offline');
  });

  // ---------------------------------------------------------------- vào, tạo, rời nhóm

  async function doCreate(name) {
    var id = rndHex(8);
    var token = rndHex(16);
    var data = await api('create', { name: name, id: id, token: token });
    S.session = { code: data.code, id: id, token: token, name: name, color: data.you.c };
    saveSession();
    applySnapshot(data);
    S.helloAt = Date.now();
    leavePrevious();
    enterMap();
  }

  /** Vào nhóm mới xong thì rời nhóm cũ (nếu có) để không bị tính hai nơi. */
  function leavePrevious() {
    var old = S.previous;
    S.previous = null;
    if (old && S.session && old.code !== S.session.code) api('leave', { code: old.code, id: old.id, token: old.token }).catch(noop);
  }

  async function doJoin(code, name) {
    var id = rndHex(8);
    var token = rndHex(16);
    var data = await api('join', { code: code, name: name, id: id, token: token });
    S.session = { code: code, id: id, token: token, name: name, color: data.you.c };
    saveSession();
    applySnapshot(data);
    S.helloAt = Date.now();
    leavePrevious();
    enterMap();
  }

  async function leaveGroup() {
    var s = S.session;
    if (!s) return;
    closeModal(true);
    try {
      await api('leave', { code: s.code, id: s.id, token: s.token });
    } catch (e) {
      /* vẫn rời phía máy mình */
    }
    teardown();
    toast('Đã rời nhóm');
    showWelcome('');
  }

  function fatal(message) {
    teardown();
    showWelcome('', message);
  }

  function teardown() {
    stopRealtime();
    stopWatch();
    setWake(false);
    S.session = null;
    S.sharing = false;
    S.geo = 'idle';
    S.me = null;
    S.members = new Map();
    S.rally = null;
    S.alerts = new Map();
    S.helloAt = 0;
    S.mode = 'all';
    S.followId = null;
    S.didFirstFit = false;
    S.picking = false;
    S.conn = 'connecting';
    S.lastSentPos = null;
    lsDel(SESSION_KEY);
    if (S.map) {
      S.markers.forEach(function (e) {
        removeMarker(e);
      });
      S.markers.clear();
      if (S.rallyMarker) {
        S.rallyMarker.remove();
        S.rallyMarker = null;
      }
    }
    S.rows.forEach(function (row) {
      row.li.remove();
    });
    S.rows.clear();
    S.banners.forEach(function (b) {
      b.el.remove();
    });
    S.banners.clear();
    closeModal(true);
  }

  // ---------------------------------------------------------------- màn hình chào

  var welcomeMode = 'create'; // create | code | invite
  var inviteCode = '';

  function showWelcome(invite, message) {
    $('#mapscreen').hidden = true;
    $('#welcome').hidden = false;
    inviteCode = invite || '';
    $('#inapp-warn').hidden = !IN_APP;
    var saved = lsGet(NAME_KEY);
    if (saved && !$('#in-name').value) $('#in-name').value = saved;
    setWelcomeMode(inviteCode ? 'invite' : 'create');
    var err = $('#form-error');
    if (message) {
      err.textContent = message;
      err.hidden = false;
    } else {
      err.hidden = true;
    }
  }

  function setWelcomeMode(mode) {
    welcomeMode = mode;
    $('#invite-note').hidden = mode !== 'invite';
    if (mode === 'invite') $('#invite-code').textContent = GN.showCode(inviteCode);
    $('#code-row').hidden = mode !== 'code';
    $('#btn-primary').textContent = mode === 'create' ? 'Tạo nhóm mới' : 'Vào nhóm';
    $('#btn-toggle').hidden = mode === 'invite';
    $('#btn-toggle').textContent = mode === 'code' ? 'Chưa có nhóm? Tạo nhóm mới' : 'Đã có mã nhóm? Nhập mã';
  }

  function setupWelcome() {
    var form = $('#join-form');
    var errEl = $('#form-error');
    function showErr(text) {
      errEl.textContent = text;
      errEl.hidden = !text;
    }
    $('#btn-toggle').addEventListener('click', function () {
      setWelcomeMode(welcomeMode === 'code' ? 'create' : 'code');
      showErr('');
      if (welcomeMode === 'code' && $('#in-name').value.trim()) $('#in-code').focus();
    });
    $('#in-code').addEventListener('input', function (e) {
      var n = GN.normCode(e.target.value);
      e.target.value = n.length > 4 ? n.slice(0, 4) + '-' + n.slice(4) : n;
    });
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var name = cleanName($('#in-name').value);
      if (!name) {
        showErr('Hãy nhập tên để mọi người nhận ra bạn.');
        $('#in-name').focus();
        return;
      }
      var code = welcomeMode === 'invite' ? inviteCode : GN.normCode($('#in-code').value);
      if (welcomeMode !== 'create' && code.length !== 8) {
        showErr(errText({ code: 'bad_code' }));
        $('#in-code').focus();
        return;
      }
      showErr('');
      var btn = $('#btn-primary');
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Đang vào…';
      unlockAudio();
      try {
        lsSet(NAME_KEY, name);
        if (welcomeMode === 'create') await doCreate(name);
        else await doJoin(code, name);
      } catch (e) {
        showErr(errText(e));
      } finally {
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  }

  // ---------------------------------------------------------------- vào màn hình bản đồ

  function enterMap() {
    $('#welcome').hidden = true;
    $('#mapscreen').hidden = false;
    initMap();
    S.map.invalidateSize();
    $('#chip-code').textContent = GN.showCode(S.session.code);
    try {
      history.replaceState(null, '', location.pathname);
    } catch (e) {
      /* bỏ qua */
    }
    setSheet(false);
    S.mode = 'all';
    S.didFirstFit = false;
    updateModeButtons();
    startRealtime();
    var pref = lsGet(SHARE_KEY);
    if (pref === true) startSharing(false);
    else if (pref === null) setTimeout(function () { if (S.session && !S.sharing && !S.modal) openShareModal(); }, 500);
    scheduleRender();
  }

  // ---------------------------------------------------------------- định vị và gửi vị trí

  function setGeo(state) {
    if (S.geo === state) return;
    S.geo = state;
    scheduleRender();
  }

  function startSharing(userInitiated) {
    S.sharing = true;
    lsSet(SHARE_KEY, true);
    if (userInitiated) unlockAudio();
    if (!('geolocation' in navigator)) return setGeo('unavailable');
    if (!window.isSecureContext) return setGeo('insecure');
    startWatch();
    setWake();
    if (S.session) api('share', auth({ on: true })).catch(noop);
    scheduleRender();
  }

  function stopSharing() {
    S.sharing = false;
    lsSet(SHARE_KEY, false);
    stopWatch();
    setGeo('idle');
    S.me = null;
    S.lastSentPos = null;
    setWake();
    if (S.session) api('share', auth({ on: false })).catch(noop);
    scheduleRender();
  }

  function startWatch() {
    stopWatch();
    if (S.geo !== 'live') setGeo('asking');
    S.watchId = navigator.geolocation.watchPosition(onFix, onGeoError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    setTimeout(function () {
      if (S.sharing && (S.geo === 'asking' || S.geo === 'searching') && !S.me) setGeo('searching');
    }, 8000);
  }

  function stopWatch() {
    if (S.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(S.watchId);
    S.watchId = null;
  }

  function onFix(p) {
    if (!S.sharing) return;
    if (Date.now() - p.timestamp > 120000) return; // bỏ qua vị trí cũ do trình duyệt lưu đệm
    var c = p.coords;
    S.me = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, spd: c.speed, hdg: c.heading, t: Date.now() };
    if (S.geo !== 'live') setGeo('live');
    maybeSend(S.lastSentPos == null);
    scheduleRender();
  }

  function onGeoError(err) {
    if (err.code === 1) {
      stopWatch();
      setGeo('denied');
      S.me = null;
      S.lastSentPos = null;
      if (S.session) api('share', auth({ on: false })).catch(noop);
      if (!S.modal) openShareModal();
    } else if (!S.me) {
      // Chưa có vị trí nào: GPS đang tìm
      if (S.geo !== 'live') setGeo('searching');
    } else if (err.code === 2 && Date.now() - S.me.t > 60000) {
      // Đang có tín hiệu thì bị mất (hầm, trong nhà kín): ngừng báo "trực tiếp" cho tới khi có vị trí mới.
      // Lỗi hết thời gian chờ (code 3) bỏ qua vì máy tính để bàn đứng yên thường không có vị trí mới.
      setGeo('searching');
    }
  }

  function maybeSend(force) {
    if (!S.sharing || !S.me || !S.session) return;
    var now = Date.now();
    var moved = S.lastSentPos ? GN.distance(S.lastSentPos, S.me) : Infinity;
    var gap = now - S.lastSent;
    if (!force && !((gap >= SEND_MIN_GAP && moved >= SEND_MIN_MOVE) || gap >= SEND_HEARTBEAT)) return;
    if (S.sending) {
      S.pendingSend = true;
      return;
    }
    sendNow();
  }

  async function sendNow() {
    S.sending = true;
    S.pendingSend = false;
    var p = S.me;
    S.lastSent = Date.now();
    S.lastSentPos = { lat: p.lat, lng: p.lng };
    try {
      await api('pos', auth({ lat: p.lat, lng: p.lng, acc: p.acc, spd: p.spd, hdg: p.hdg }));
    } catch (e) {
      if (e && e.status === 404) startRealtime(); // máy chủ đã quên nhóm: vào lại để dựng lại
    } finally {
      S.sending = false;
      if (S.pendingSend) maybeSend(false);
    }
  }

  setInterval(function () {
    // Đứng yên hoặc trình duyệt ít báo vị trí: vẫn gửi vị trí gần nhất để mọi người biết bạn còn đó
    if (S.sharing && S.geo === 'live' && S.me && Date.now() - S.me.t < 15 * 60000) maybeSend(false);
  }, 5000);

  async function setWake(forceOff) {
    var want = !forceOff && S.sharing && S.settings.keepAwake && document.visibilityState === 'visible' && S.geo !== 'denied';
    try {
      if (want && 'wakeLock' in navigator && !S.wake) {
        var lock = await navigator.wakeLock.request('screen');
        S.wake = lock;
        lock.addEventListener('release', function () {
          if (S.wake === lock) S.wake = null;
        });
      } else if (!want && S.wake) {
        var old = S.wake;
        S.wake = null;
        await old.release();
      }
    } catch (e) {
      /* thiết bị không hỗ trợ hoặc từ chối */
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !S.session) return;
    if (S.sharing && S.geo !== 'denied' && S.geo !== 'unavailable' && S.geo !== 'insecure' && 'geolocation' in navigator) startWatch();
    setWake();
    checkStream();
    S.markers.forEach(function (e) {
      if (e.target) setCur(e, e.target);
    });
    scheduleRender();
  });
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && S.session) {
      checkStream();
      scheduleRender();
    }
  });

  // ---------------------------------------------------------------- âm báo

  var audioCtx = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) {
      /* bỏ qua */
    }
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });

  function beep() {
    if (!audioCtx || !S.settings.sound) return;
    try {
      var t = audioCtx.currentTime;
      [0, 0.24].forEach(function (off, i) {
        var o = audioCtx.createOscillator();
        var g = audioCtx.createGain();
        o.type = 'sine';
        o.frequency.value = i ? 660 : 880;
        g.gain.setValueAtTime(0.0001, t + off);
        g.gain.exponentialRampToValueAtTime(0.25, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(t + off);
        o.stop(t + off + 0.22);
      });
    } catch (e) {
      /* bỏ qua */
    }
  }

  // ---------------------------------------------------------------- cảnh báo "ai đó đi lạc"

  function evalAlerts() {
    var th = S.settings.alertM;
    var next = new Map();
    if (th > 0 && S.session) {
      var mine = myPos();
      var now = serverNow();
      S.members.forEach(function (m) {
        if (m.id === myId() || !m.sharing || !m.pos) return;
        if (now - m.pos.t > LOST_MS) {
          next.set(m.id, { kind: 'lost', age: now - m.pos.t });
          return;
        }
        if (!mine) return;
        var d = GN.distance(mine, m.pos);
        var was = S.alerts.get(m.id);
        var limit = was && was.kind === 'far' ? th * 0.85 : th; // vùng đệm để không báo đi báo lại ở ranh giới
        if (d > limit) next.set(m.id, { kind: 'far', d: d });
      });
    }
    var loud = Date.now() >= S.armedAt;
    next.forEach(function (a, id) {
      var was = S.alerts.get(id);
      if (!was || was.kind !== a.kind) {
        if (loud) notifyAlert(id, a);
      }
    });
    S.alerts = next;
  }

  function notifyAlert(id, a) {
    var m = S.members.get(id);
    if (!m) return;
    if (S.settings.sound) beep();
    try {
      if (navigator.vibrate) navigator.vibrate([220, 110, 220]);
    } catch (e) {
      /* bỏ qua */
    }
    toast(a.kind === 'far' ? m.name + ' đang cách bạn ' + GN.fmtDist(a.d) : 'Mất tín hiệu của ' + m.name);
  }

  // ---------------------------------------------------------------- bản đồ

  var PIN_HTML =
    '<div class="pin"><div class="pin-tag"><span class="pin-av"></span><span class="pin-text"><b class="pin-name"></b><i class="pin-sub"></i></span></div><span class="pin-tip"></span></div>';

  function initMap() {
    if (S.map) return;
    var map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 3, maxZoom: 19 });
    map.attributionControl.setPrefix(false);
    L.tileLayer(OSM_URL, { maxZoom: 19, attribution: OSM_ATTR }).addTo(map);
    map.setView(VN_CENTER, 6);
    map.on('dragstart', function () {
      if (S.mode !== 'free') setMode('free');
    });
    map.on('zoomstart', function () {
      if (S.mode === 'all' && Date.now() > S.progUntil) setMode('free');
    });
    map.on('zoomend', updateCompact);
    map.on('click', onMapClick);
    S.map = map;
    updateCompact();
  }

  function updateCompact() {
    if (!S.map) return;
    $('#map').classList.toggle('map-compact', S.map.getZoom() <= 11);
  }

  function isWide() {
    return window.matchMedia && window.matchMedia('(min-width: 720px)').matches;
  }

  function sheetVisibleHeight() {
    var scr = $('#mapscreen');
    if (isWide() || scr.hidden) return 0;
    var sheet = $('#sheet');
    var safe = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;
    return S.sheetOpen ? Math.min(scr.clientHeight * 0.66, 560) : 118 + safe;
  }

  /** Vùng nhìn an toàn cho việc căn bản đồ: tránh thanh trên, ngăn danh sách và các nút nổi.
   *  Ghim có phần thân nằm phía TRÊN điểm neo (cao khoảng 50 px, rộng tới 170 px) nên chừa thêm chỗ. */
  function fitPadding() {
    var top = $('.topbar').offsetHeight + $('#banners').offsetHeight + 64;
    if (isWide()) return { paddingTopLeft: L.point(430, top), paddingBottomRight: L.point(100, 48) };
    return { paddingTopLeft: L.point(92, top), paddingBottomRight: L.point(92, sheetVisibleHeight() + 24) };
  }

  function collectPoints() {
    var pts = [];
    S.members.forEach(function (m) {
      var p = m.id === myId() ? myPos() : m.sharing ? m.pos : null;
      if (p) pts.push({ lat: p.lat, lng: p.lng });
    });
    if (S.rally) pts.push({ lat: S.rally.lat, lng: S.rally.lng });
    return pts;
  }

  function programmatic() {
    S.progUntil = Date.now() + 1600;
  }

  function fitPoints(pts, maxZoom) {
    if (!pts.length || !S.map) return;
    programmatic();
    var bounds = L.latLngBounds(
      pts.map(function (p) {
        return [p.lat, p.lng];
      })
    );
    var opts = fitPadding();
    opts.maxZoom = maxZoom;
    opts.animate = true;
    S.map.fitBounds(bounds, opts);
  }

  function fitAll() {
    var pts = collectPoints();
    S.lastFit = Date.now();
    fitPoints(pts, pts.length === 1 ? 16 : 17);
  }

  /** Có điểm nào nằm ngoài vùng nhìn thấy, hoặc cả nhóm quá nhỏ so với màn hình thì cần căn lại. */
  function needsRefit(pts) {
    var map = S.map;
    var pad = fitPadding();
    var size = map.getSize();
    var minX = pad.paddingTopLeft.x;
    var minY = pad.paddingTopLeft.y;
    var maxX = size.x - pad.paddingBottomRight.x;
    var maxY = size.y - pad.paddingBottomRight.y;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var q = map.latLngToContainerPoint([pts[i].lat, pts[i].lng]);
      if (q.x < minX || q.x > maxX || q.y < minY || q.y > maxY) return true;
      x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x);
      y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
    }
    if (pts.length > 1 && map.getZoom() < 17 && x1 - x0 < (maxX - minX) * 0.3 && y1 - y0 < (maxY - minY) * 0.3) return true;
    return false;
  }

  function followTarget() {
    if (S.mode === 'me') return myPos();
    if (S.mode === 'member') {
      var m = S.members.get(S.followId);
      return m && m.sharing && m.pos ? m.pos : null;
    }
    return null;
  }

  function applyCamera() {
    if (!S.map || $('#mapscreen').hidden) return;
    var now = Date.now();
    var pts = collectPoints();
    if (!S.didFirstFit && pts.length) {
      S.didFirstFit = true;
      fitAll();
      return;
    }
    if (S.mode === 'all') {
      if (pts.length && now - S.lastFit > 4000 && needsRefit(pts)) fitAll();
    } else if (S.mode === 'me' || S.mode === 'member') {
      var t = followTarget();
      if (!t || now - S.lastFollow < 1500) return;
      if (S.lastFollowPos && GN.distance(S.lastFollowPos, t) < 5) return;
      S.lastFollow = now;
      S.lastFollowPos = { lat: t.lat, lng: t.lng };
      fitPoints([t], Math.max(S.map.getZoom(), 16));
    }
  }

  function setMode(mode, followId) {
    S.mode = mode;
    S.followId = mode === 'member' ? followId : null;
    S.lastFollowPos = null;
    S.lastFollow = 0;
    updateModeButtons();
    scheduleRender();
  }

  function updateModeButtons() {
    $('#fab-all').setAttribute('aria-pressed', String(S.mode === 'all'));
    $('#fab-me').setAttribute('aria-pressed', String(S.mode === 'me'));
  }

  function focusMember(id) {
    var m = S.members.get(id);
    if (!m) return;
    if (id === myId()) {
      if (!myPos()) return toast('Chưa có vị trí của bạn');
      setMode('me');
      S.lastFollow = 0;
      applyCamera();
      return;
    }
    if (!m.sharing || !m.pos) return toast(m.name + ' chưa chia sẻ vị trí');
    setMode('member', id);
    applyCamera();
    setSheet(false);
  }

  // ---------------------------------------------------------------- ghim thành viên

  function createMarker(m, isMe) {
    var icon = L.divIcon({ className: 'pin-icon', html: PIN_HTML, iconSize: [0, 0], iconAnchor: [0, 0] });
    // Ghim của mình nằm dưới ghim người khác: hai người đứng cạnh nhau thì vẫn thấy tên người kia
    var marker = L.marker([0, 0], { icon: icon, keyboard: false, zIndexOffset: isMe ? -10000 : 0 });
    marker.addTo(S.map);
    var root = marker.getElement();
    var pin = root.firstElementChild;
    var e = {
      id: m.id,
      marker: marker,
      circle: null,
      pin: pin,
      av: pin.querySelector('.pin-av'),
      name: pin.querySelector('.pin-name'),
      sub: pin.querySelector('.pin-sub'),
      cur: null,
      target: null,
      raf: 0,
      timer: 0,
    };
    marker.on('click', function () {
      openMember(m.id);
    });
    return e;
  }

  function removeMarker(e) {
    cancelAnimationFrame(e.raf);
    clearTimeout(e.timer);
    e.marker.remove();
    if (e.circle) e.circle.remove();
  }

  function setCur(e, p) {
    e.cur = p;
    e.marker.setLatLng(p);
    if (e.circle) e.circle.setLatLng(p);
  }

  function animateTo(e, to) {
    var from = e.cur;
    cancelAnimationFrame(e.raf);
    clearTimeout(e.timer);
    var dist = GN.distance(from, to);
    if (dist > 3000 || dist < 0.5) return setCur(e, to);
    var dur = Math.min(1200, Math.max(500, dist * 14));
    var t0 = performance.now();
    function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var ease = 1 - Math.pow(1 - k, 3);
      setCur(e, { lat: from.lat + (to.lat - from.lat) * ease, lng: from.lng + (to.lng - from.lng) * ease });
      if (k < 1) e.raf = requestAnimationFrame(step);
    }
    e.raf = requestAnimationFrame(step);
    e.timer = setTimeout(function () {
      cancelAnimationFrame(e.raf);
      setCur(e, to);
    }, dur + 150);
  }

  function updateMarker(e, m, pos, isMe, now) {
    var col = GN.COLORS[m.c % GN.COLORS.length];
    e.pin.style.setProperty('--c', col.bg);
    e.pin.style.setProperty('--fg', col.fg);
    e.av.textContent = GN.initial(m.name);
    e.name.textContent = isMe ? 'Bạn' : m.name;
    var state = isMe ? 'live' : GN.ageState(now - pos.t);
    var sub = '';
    if (isMe) {
      sub = pos.acc && pos.acc > 60 ? '±' + Math.round(pos.acc) + ' m' : '';
    } else if (state === 'live') {
      var mine = myPos();
      sub = mine ? GN.fmtDist(GN.distance(mine, pos)) : '';
    } else {
      sub = GN.fmtAgo(now - pos.t);
    }
    e.sub.textContent = sub;
    e.pin.classList.toggle('me', isMe);
    e.pin.classList.toggle('stale', state === 'recent');
    e.pin.classList.toggle('lost', state === 'lost');

    var to = { lat: pos.lat, lng: pos.lng };
    if (!e.cur) {
      e.cur = to;
      e.marker.setLatLng(to);
    } else if (!e.target || e.target.lat !== to.lat || e.target.lng !== to.lng) {
      animateTo(e, to);
    }
    e.target = to;

    var acc = pos.acc;
    if (acc && acc > 35 && acc < 3000) {
      if (!e.circle) {
        e.circle = L.circle(e.cur, { radius: acc, color: col.bg, weight: 1, opacity: 0.45, fillColor: col.bg, fillOpacity: 0.1, interactive: false });
        e.circle.addTo(S.map);
      } else {
        e.circle.setRadius(acc);
        e.circle.setStyle({ color: col.bg, fillColor: col.bg });
      }
    } else if (e.circle) {
      e.circle.remove();
      e.circle = null;
    }
  }

  function renderMarkers() {
    if (!S.map) return;
    var now = serverNow();
    var seen = new Set();
    S.members.forEach(function (m) {
      var isMe = m.id === myId();
      var pos = isMe ? myPos() : m.sharing ? m.pos : null;
      if (!pos) return;
      seen.add(m.id);
      var e = S.markers.get(m.id);
      if (!e) {
        e = createMarker(m, isMe);
        S.markers.set(m.id, e);
      }
      updateMarker(e, m, pos, isMe, now);
    });
    S.markers.forEach(function (e, id) {
      if (!seen.has(id)) {
        removeMarker(e);
        S.markers.delete(id);
      }
    });
    renderRallyMarker();
  }

  function renderRallyMarker() {
    var r = S.rally;
    if (!r) {
      if (S.rallyMarker) {
        S.rallyMarker.marker.remove();
        S.rallyMarker = null;
      }
      return;
    }
    if (!S.rallyMarker) {
      var ic = L.divIcon({ className: 'pin-icon', html: PIN_HTML, iconSize: [0, 0], iconAnchor: [0, 0] });
      var marker = L.marker([r.lat, r.lng], { icon: ic, keyboard: false, zIndexOffset: 500 });
      marker.addTo(S.map);
      var pin = marker.getElement().firstElementChild;
      pin.classList.add('rally');
      pin.querySelector('.pin-av').appendChild(icon('flag'));
      pin.style.setProperty('--c', '#F2B53A');
      pin.style.setProperty('--fg', '#2B1D00');
      marker.on('click', openRally);
      S.rallyMarker = { marker: marker, pin: pin, name: pin.querySelector('.pin-name'), sub: pin.querySelector('.pin-sub') };
    }
    var rm = S.rallyMarker;
    rm.marker.setLatLng([r.lat, r.lng]);
    rm.name.textContent = r.label;
    var mine = myPos();
    rm.sub.textContent = mine ? GN.fmtDist(GN.distance(mine, r)) : '';
  }

  // ---------------------------------------------------------------- điểm hẹn

  function startPicking() {
    closeModal();
    S.picking = true;
    $('#mapscreen').classList.add('picking');
    setSheet(false);
    scheduleRender();
  }
  function stopPicking() {
    S.picking = false;
    $('#mapscreen').classList.remove('picking');
    scheduleRender();
  }
  function onMapClick(e) {
    if (!S.picking) return;
    openRallyForm({ lat: e.latlng.lat, lng: e.latlng.lng });
  }

  function openRallyForm(point) {
    stopPicking();
    var input = h('input', { id: 'rally-label', type: 'text', maxlength: '40', value: S.rally ? S.rally.label : 'Điểm hẹn', autocomplete: 'off', enterkeyhint: 'done' });
    var chips = h(
      'div',
      { class: 'chips' },
      ['Trạm dừng chân', 'Ăn trưa', 'Đổ xăng', 'Khách sạn', 'Chỗ gửi xe'].map(function (t) {
        return h('button', {
          class: 'chipbtn',
          type: 'button',
          text: t,
          onclick: function () {
            input.value = t;
          },
        });
      })
    );
    var save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Đặt điểm hẹn' });
    save.addEventListener('click', async function () {
      save.disabled = true;
      try {
        await api('rally', auth({ lat: point.lat, lng: point.lng, label: input.value }));
        closeModal();
        toast('Đã đặt điểm hẹn cho cả nhóm');
      } catch (err) {
        save.disabled = false;
        toast(errText(err));
      }
    });
    openModal(
      'Đặt điểm hẹn',
      h('div', { class: 'stack' }, h('p', { class: 'muted', text: 'Cả nhóm sẽ thấy điểm này trên bản đồ, kèm khoảng cách và nút chỉ đường.' }), h('label', { for: 'rally-label', text: 'Tên điểm hẹn' }), input, chips, save)
    );
  }

  function openRally() {
    var r = S.rally;
    if (!r) return startPicking();
    var mine = myPos();
    var facts = h(
      'div',
      { class: 'facts' },
      h('div', { class: 'fact' }, h('small', { text: 'Cách bạn' }), h('b', { text: mine ? GN.fmtDist(GN.distance(mine, r)) : 'Chưa rõ' })),
      h('div', { class: 'fact' }, h('small', { text: 'Do ai đặt' }), h('b', { text: r.byName })),
      h('div', { class: 'fact' }, h('small', { text: 'Lúc' }), h('b', { text: GN.fmtTime(r.at) }))
    );
    var buttons = h(
      'div',
      { class: 'stack' },
      directionsLinks(r),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Xem trên bản đồ', onclick: function () { closeModal(); setMode('free'); programmatic(); S.map.fitBounds([[r.lat, r.lng], [r.lat, r.lng]], Object.assign({ maxZoom: 16 }, fitPadding())); } }),
        h('button', { class: 'btn btn-ghost', type: 'button', text: 'Đổi vị trí', onclick: startPicking })
      ),
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        text: 'Xoá điểm hẹn',
        onclick: async function () {
          try {
            await api('rally', auth({ clear: true }));
            closeModal();
            toast('Đã xoá điểm hẹn');
          } catch (err) {
            toast(errText(err));
          }
        },
      })
    );
    openModal(r.label, h('div', null, facts, buttons));
  }

  function directionsLinks(pos) {
    var links = [h('a', { class: 'btn btn-primary', href: GN.directionsUrl(pos, 'google'), target: '_blank', rel: 'noopener' }, icon('nav'), 'Chỉ đường bằng Google Maps')];
    if (IS_IOS) links.push(h('a', { class: 'btn btn-ghost', href: GN.directionsUrl(pos, 'apple'), target: '_blank', rel: 'noopener' }, 'Chỉ đường bằng Apple Maps'));
    return links;
  }

  // ---------------------------------------------------------------- ngăn danh sách thành viên

  function setSheet(open) {
    S.sheetOpen = open;
    var scr = $('#mapscreen');
    scr.setAttribute('data-sheet', open ? 'open' : 'collapsed');
    $('#sheet').setAttribute('data-state', open ? 'open' : 'collapsed');
    var hd = $('#sheet-handle');
    hd.setAttribute('aria-expanded', String(open));
    hd.setAttribute('aria-label', open ? 'Thu gọn danh sách' : 'Mở danh sách thành viên');
    var tst = $('#toast');
    if (tst.classList.contains('show') && !isWide()) tst.style.setProperty('--toast-bottom', sheetVisibleHeight() + 16 + 'px');
    setTimeout(function () {
      if (S.mode === 'all' && S.map) {
        S.lastFit = 0;
        applyCamera();
      }
    }, 330);
  }

  /** Chạm vào tay nắm hoặc phần đầu ngăn để mở/thu gọn; vuốt lên mở, vuốt xuống thu gọn.
   *  Theo dõi con trỏ trên document trong lúc vuốt để ngón tay hay chuột rời khỏi tay nắm vẫn tính. */
  function setupSheet() {
    var startY = null;
    var moved = false;
    var onButton = false;

    function onMove(e) {
      if (startY == null) return;
      var dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > 18) {
        moved = true;
        setSheet(dy < 0);
      }
    }
    function end() {
      startY = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', end);
    }
    function onUp(e) {
      if (startY != null && !moved && !onButton && Math.abs(e.clientY - startY) < 8) setSheet(!S.sheetOpen);
      end();
    }
    function onDown(e) {
      if (e.button != null && e.button > 0) return;
      end();
      startY = e.clientY;
      moved = false;
      onButton = !!(e.target.closest && e.target.closest('button.btn'));
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', end);
    }

    $('#sheet-handle').addEventListener('pointerdown', onDown);
    $('.sheet-head').addEventListener('pointerdown', onDown);
    $('#sheet-handle').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setSheet(!S.sheetOpen);
      }
    });
  }

  function orderedMembers() {
    var list = [];
    var me = S.members.get(myId());
    if (me) list.push(me);
    S.members.forEach(function (m) {
      if (m.id !== myId()) list.push(m);
    });
    return list;
  }

  function memberView(m, now) {
    var isMe = m.id === myId();
    var v = { sub: '', state: 'none', dist: '', speed: '' };
    if (isMe) {
      if (!S.sharing) v.sub = 'Bạn đang tạm dừng chia sẻ';
      else if (S.geo === 'live') {
        v.sub = 'Đang chia sẻ cho cả nhóm';
        v.state = 'live';
      } else if (S.geo === 'denied') v.sub = 'Chưa được cấp quyền vị trí';
      else if (S.geo === 'insecure' || S.geo === 'unavailable') v.sub = 'Máy này chưa định vị được';
      else v.sub = 'Đang tìm vị trí…';
      return v;
    }
    if (!m.sharing) {
      v.sub = 'Chưa chia sẻ vị trí';
      return v;
    }
    if (!m.pos) {
      v.sub = 'Đang tìm vị trí…';
      return v;
    }
    var age = now - m.pos.t;
    v.state = GN.ageState(age);
    v.speed = GN.fmtSpeed(m.pos.spd);
    if (v.state === 'live') v.sub = 'Trực tiếp' + (v.speed ? ' · ' + v.speed : '');
    else if (v.state === 'recent') v.sub = GN.fmtAgo(age);
    else v.sub = 'Mất tín hiệu từ ' + GN.fmtTime(m.pos.t);
    var mine = myPos();
    if (mine) v.dist = GN.fmtDist(GN.distance(mine, m.pos));
    return v;
  }

  function createRow(m) {
    var av = h('span', { class: 'av' }, h('span', { class: 'ch' }), h('i', { class: 'led' }));
    var name = h('span', { class: 'member-name' });
    var sub = h('span', { class: 'member-sub' });
    var dist = h('span', { class: 'member-dist' });
    var btn = h(
      'button',
      {
        class: 'member',
        type: 'button',
        onclick: function () {
          openMember(m.id);
        },
      },
      av,
      h('span', { class: 'member-main' }, name, sub),
      dist
    );
    var li = h('li', null, btn);
    return { li: li, btn: btn, av: av, ch: av.firstChild, led: av.lastChild, name: name, sub: sub, dist: dist };
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function renderList() {
    var ul = $('#member-list');
    var now = serverNow();
    var list = orderedMembers();
    S.rows.forEach(function (row, id) {
      if (!S.members.has(id)) {
        row.li.remove();
        S.rows.delete(id);
      }
    });
    list.forEach(function (m, idx) {
      var row = S.rows.get(m.id);
      if (!row) {
        row = createRow(m);
        S.rows.set(m.id, row);
      }
      var col = GN.COLORS[m.c % GN.COLORS.length];
      var v = memberView(m, now);
      var isMe = m.id === myId();
      row.av.style.setProperty('--c', col.bg);
      row.av.style.setProperty('--fg', col.fg);
      setText(row.ch, GN.initial(m.name));
      row.led.setAttribute('data-s', v.state);
      if (row.name.getAttribute('data-n') !== m.name + '|' + isMe) {
        row.name.setAttribute('data-n', m.name + '|' + isMe);
        row.name.textContent = '';
        row.name.appendChild(document.createTextNode(m.name));
        if (isMe) row.name.appendChild(h('em', { text: ' · Bạn' }));
      }
      setText(row.sub, v.sub);
      row.sub.setAttribute('data-s', v.state);
      if (row.dist.getAttribute('data-d') !== v.dist) {
        row.dist.setAttribute('data-d', v.dist);
        row.dist.textContent = '';
        if (v.dist) {
          row.dist.appendChild(document.createTextNode(v.dist));
          row.dist.appendChild(h('small', { text: 'cách bạn' }));
        }
      }
      if (ul.children[idx] !== row.li) ul.insertBefore(row.li, ul.children[idx] || null);
    });
    var empty = $('.list-empty', ul);
    if (list.length <= 1) {
      if (!empty) ul.appendChild(h('li', { class: 'list-empty', text: 'Chưa có ai khác trong nhóm. Bấm “Mời” để gửi link cho người thân.' }));
    } else if (empty) {
      empty.remove();
    }
  }

  function renderSummary() {
    var list = orderedMembers();
    var now = serverNow();
    var live = 0;
    list.forEach(function (m) {
      var v = memberView(m, now);
      if (v.state === 'live') live++;
    });
    var n = list.length;
    var small = n <= 3; // nhóm nhỏ thì còn chỗ cho chữ "trong nhóm"
    $('#sum-main').textContent = n + (small ? ' người trong nhóm' : ' người');
    var sub;
    if (n <= 1) sub = 'Mời người thân vào nhóm';
    else if (live === 0) sub = 'Chưa ai có tín hiệu';
    else sub = live + (small ? ' người đang trực tiếp' : ' đang trực tiếp');
    $('#sum-sub').textContent = sub;
    var av = $('#avatars');
    av.textContent = '';
    list.slice(0, n > 4 ? 3 : n).forEach(function (m) {
      var col = GN.COLORS[m.c % GN.COLORS.length];
      var a = h('span', { class: 'av', text: GN.initial(m.name) });
      a.style.setProperty('--c', col.bg);
      a.style.setProperty('--fg', col.fg);
      av.appendChild(a);
    });
    if (n > 4) av.appendChild(h('span', { class: 'av more', text: '+' + (n - 3) }));
  }

  function renderStatus() {
    var pill = $('#status-pill');
    var state = 'idle';
    var text = 'Chưa chia sẻ';
    if (S.sharing) {
      if (S.geo === 'denied') (state = 'error'), (text = 'Chưa có quyền');
      else if (S.geo === 'insecure' || S.geo === 'unavailable') (state = 'error'), (text = 'Không định vị');
      else if (S.geo === 'live') (state = S.conn === 'online' ? 'live' : 'search'), (text = S.conn === 'online' ? 'Đang chia sẻ' : 'Kết nối lại…');
      else (state = 'search'), (text = 'Đang tìm GPS');
    } else if (S.conn !== 'online') {
      (state = 'search'), (text = 'Đang kết nối');
    }
    pill.setAttribute('data-state', state);
    setText($('#status-text'), text);
  }

  // ---------------------------------------------------------------- thanh thông báo

  function computeBanners() {
    var list = [];
    if (S.picking) {
      list.push({
        key: 'pick',
        kind: 'info',
        text: 'Chạm vào bản đồ để chọn điểm hẹn.',
        actions: [
          { label: 'Chỗ tôi', onClick: function () { var p = myPos(); if (p) openRallyForm(p); else toast('Chưa có vị trí của bạn'); } },
          { label: 'Huỷ', ghost: true, onClick: stopPicking },
        ],
      });
    }
    if (S.conn === 'offline' && Date.now() - S.offlineSince > 2500) {
      list.push({ key: 'offline', kind: 'warn', text: 'Mất kết nối. Đang thử lại…', actions: [] });
    }
    if (S.sharing && S.geo === 'denied') {
      list.push({ key: 'denied', kind: 'danger', text: 'Chưa có quyền dùng vị trí nên mọi người chưa thấy bạn.', actions: [{ label: 'Cách bật', onClick: openShareModal }] });
    } else if (S.sharing && (S.geo === 'insecure' || S.geo === 'unavailable')) {
      list.push({
        key: 'nogeo',
        kind: 'danger',
        text: S.geo === 'insecure' ? 'Trang này chưa dùng HTTPS nên trình duyệt không cho định vị.' : 'Thiết bị hoặc trình duyệt này không hỗ trợ định vị.',
        actions: [],
      });
    }
    S.alerts.forEach(function (a, id) {
      var m = S.members.get(id);
      if (!m) return;
      list.push({
        key: 'alert:' + id,
        kind: a.kind === 'far' ? 'danger' : 'warn',
        text: a.kind === 'far' ? m.name + ' đang cách bạn ' + GN.fmtDist(a.d) + '.' : 'Mất tín hiệu của ' + m.name + ' (' + GN.fmtAgo(a.age) + ').',
        actions: [{ label: 'Xem', onClick: function () { focusMember(id); } }],
      });
    });
    if (S.mode === 'member' && S.followId && S.members.get(S.followId)) {
      list.push({
        key: 'follow',
        kind: 'info',
        text: 'Đang theo dõi ' + S.members.get(S.followId).name + '.',
        actions: [{ label: 'Dừng', ghost: true, onClick: function () { setMode('all'); S.lastFit = 0; applyCamera(); } }],
      });
    }
    return list;
  }

  function renderBanners() {
    var root = $('#banners');
    var list = computeBanners();
    var keys = new Set(
      list.map(function (b) {
        return b.key;
      })
    );
    S.banners.forEach(function (b, key) {
      if (!keys.has(key)) {
        b.el.remove();
        S.banners.delete(key);
      }
    });
    list.forEach(function (b, idx) {
      var entry = S.banners.get(b.key);
      if (!entry) {
        var textEl = h('div', { class: 'banner-text' });
        var el = h('div', { class: 'banner', role: 'status' }, textEl);
        entry = { el: el, textEl: textEl, sig: '' };
        S.banners.set(b.key, entry);
      }
      entry.handlers = b.actions;
      var sig = b.actions
        .map(function (a) {
          return a.label;
        })
        .join('|');
      if (entry.sig !== sig) {
        entry.sig = sig;
        Array.prototype.slice.call(entry.el.querySelectorAll('button')).forEach(function (x) {
          x.remove();
        });
        b.actions.forEach(function (a, i) {
          entry.el.appendChild(
            h('button', {
              class: 'btn ' + (a.ghost ? 'btn-ghost' : 'btn-primary'),
              type: 'button',
              text: a.label,
              onclick: function () {
                var cur = entry.handlers[i];
                if (cur) cur.onClick();
              },
            })
          );
        });
      }
      setText(entry.textEl, b.text);
      entry.el.setAttribute('data-kind', b.kind);
      if (root.children[idx] !== entry.el) root.insertBefore(entry.el, root.children[idx] || null);
    });
  }

  // ---------------------------------------------------------------- vẽ lại

  var renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(function () {
      renderQueued = false;
      renderAll();
    });
  }

  function renderAll() {
    if (!S.session || $('#mapscreen').hidden) return;
    evalAlerts();
    renderStatus();
    renderBanners();
    renderMarkers();
    renderList();
    renderSummary();
    $('#fab-rally').classList.toggle('has-rally', !!S.rally);
    $('#fab-rally').setAttribute('aria-label', S.rally ? 'Xem điểm hẹn' : 'Đặt điểm hẹn');
    applyCamera();
  }

  setInterval(function () {
    if (S.session && document.visibilityState === 'visible') scheduleRender();
  }, 5000);
  window.addEventListener('resize', function () {
    if (S.map) {
      S.map.invalidateSize();
      S.lastFit = 0;
    }
    scheduleRender();
  });

  // ---------------------------------------------------------------- các hộp thoại

  function inviteLink() {
    return location.origin + '/?g=' + S.session.code;
  }

  function openInvite() {
    var code = GN.showCode(S.session.code);
    var link = inviteLink();
    var shareBtn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('share'), 'Gửi link mời');
    shareBtn.addEventListener('click', async function () {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Gần Nhau', text: 'Vào nhóm của mình trên Gần Nhau để xem vị trí của nhau nhé. Mã nhóm: ' + code, url: link });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      var ok = await copyText(link);
      toast(ok ? 'Đã sao chép link mời' : 'Hãy chạm giữ link để sao chép');
    });
    var copyBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, icon('copy'), 'Sao chép link');
    copyBtn.addEventListener('click', async function () {
      var ok = await copyText(link);
      toast(ok ? 'Đã sao chép link mời' : 'Hãy chạm giữ link để sao chép');
    });
    var nodes = [
      h('p', { class: 'muted', text: 'Gửi link này cho người thân. Họ mở bằng Safari hoặc Chrome, nhập tên là vào được.' }),
      h('span', { class: 'code-big', text: code }),
      h('p', { class: 'link-box', text: link }),
      h('div', { class: 'btn-row' }, shareBtn, copyBtn),
    ];
    if (IN_APP) nodes.push(h('p', { class: 'tip', text: 'Bạn đang mở trong ứng dụng khác. Nếu định vị không hoạt động, hãy mở trang này bằng Safari hoặc Chrome.' }));
    openModal('Mời người thân', h('div', null, nodes));
  }

  function switchRow(title, desc, checked, onChange) {
    var sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': title });
    sw.addEventListener('click', function () {
      var on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      onChange(on);
    });
    return h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('b', { text: title }), desc ? h('span', { text: desc }) : null), sw);
  }

  function openSettings() {
    var s = S.settings;
    var sel = h('select', { id: 'alert-select', 'aria-label': 'Báo khi ai đó cách xa' });
    [
      [0, 'Tắt'],
      [300, '300 m'],
      [500, '500 m'],
      [1000, '1 km'],
      [2000, '2 km'],
      [5000, '5 km'],
    ].forEach(function (o) {
      var opt = h('option', { value: String(o[0]), text: o[1] });
      if (s.alertM === o[0]) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', function () {
      s.alertM = parseInt(sel.value, 10) || 0;
      saveSettings();
      S.alerts = new Map();
      S.armedAt = Date.now() + 1500;
      scheduleRender();
      if (s.alertM) unlockAudio();
    });
    var nameInput = h('input', { id: 'set-name', type: 'text', maxlength: '20', value: S.session.name, autocomplete: 'off', 'aria-label': 'Tên hiển thị' });
    var nameBtn = h('button', { class: 'btn btn-ghost btn-small', type: 'button', text: 'Lưu' });
    nameBtn.addEventListener('click', async function () {
      var n = cleanName(nameInput.value);
      if (!n) return toast(errText({ code: 'bad_name' }));
      if (n === S.session.name) return toast('Tên không thay đổi');
      try {
        var snap = await api('join', auth({ name: n, restore: true }));
        S.session.name = n;
        saveSession();
        lsSet(NAME_KEY, n);
        applySnapshot(snap);
        scheduleRender();
        toast('Đã đổi tên');
      } catch (e) {
        toast(errText(e));
      }
    });
    var leaveBtn = h('button', { class: 'btn btn-danger', type: 'button', text: 'Rời nhóm' });
    var armed = false;
    leaveBtn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        leaveBtn.textContent = 'Bấm lần nữa để rời nhóm';
        setTimeout(function () {
          armed = false;
          leaveBtn.textContent = 'Rời nhóm';
        }, 4000);
        return;
      }
      leaveGroup();
    });
    var nodes = [
      switchRow('Chia sẻ vị trí của tôi', 'Tắt thì cả nhóm không thấy bạn', S.sharing, function (on) {
        if (on) startSharing(true);
        else stopSharing();
      }),
      h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('b', { text: 'Báo khi ai đó đi xa' }), h('span', { text: 'Rung và báo khi có người cách bạn quá mức này' })), sel),
      switchRow('Giữ màn hình sáng', 'Vị trí chỉ cập nhật khi màn hình đang mở app', s.keepAwake, function (on) {
        s.keepAwake = on;
        saveSettings();
        setWake();
      }),
      switchRow('Âm báo', 'Phát tiếng bíp khi có cảnh báo', s.sound, function (on) {
        s.sound = on;
        saveSettings();
        if (on) {
          unlockAudio();
          beep();
        }
      }),
      h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('label', { for: 'set-name', text: 'Tên hiển thị' }), nameInput), nameBtn),
    ];
    if (IS_IOS && !STANDALONE) {
      nodes.push(h('p', { class: 'tip', text: 'Mẹo cho iPhone: bấm nút Chia sẻ của Safari rồi chọn “Thêm vào MH chính” để mở như một app. Làm bước này trước khi tạo hoặc vào nhóm, vì app trên màn hình chính lưu dữ liệu riêng với Safari.' }));
    }
    nodes.push(h('div', { class: 'stack', style: 'margin-top:16px' }, leaveBtn));
    openModal('Cài đặt', h('div', null, nodes));
  }

  function consentContent() {
    var start = h('button', { class: 'btn btn-primary', type: 'button', text: 'Bắt đầu chia sẻ' });
    start.addEventListener('click', function () {
      closeModal();
      startSharing(true);
    });
    var later = h('button', { class: 'btn btn-ghost', type: 'button', text: 'Để sau' });
    later.addEventListener('click', function () {
      lsSet(SHARE_KEY, false);
      closeModal();
    });
    var n = Math.max(0, S.members.size - 1);
    var nodes = [
      h('p', { text: n > 0 ? 'Cả nhóm (' + n + ' người khác) sẽ thấy bạn trên bản đồ khi bạn mở Gần Nhau.' : 'Người trong nhóm sẽ thấy bạn trên bản đồ khi bạn mở Gần Nhau.' }),
      h('ul', { class: 'steps' },
        h('li', { text: 'Bạn có thể tạm dừng hoặc rời nhóm bất cứ lúc nào.' }),
        h('li', { text: 'Vị trí chỉ cập nhật khi màn hình đang mở app này.' }),
        h('li', { text: 'Không lưu lịch sử di chuyển.' })
      ),
      h('div', { class: 'stack' }, start, later),
    ];
    if (IS_IOS) nodes.push(h('p', { class: 'tip', text: 'Khi iPhone hỏi quyền vị trí, hãy chọn “Cho phép”.' }));
    if (IN_APP) nodes.push(h('p', { class: 'tip', text: 'Bạn đang mở trong ứng dụng khác. Nếu không hỏi quyền vị trí, hãy mở trang này bằng Safari hoặc Chrome.' }));
    return nodes;
  }

  function helpContent() {
    var retry = h('button', { class: 'btn btn-primary', type: 'button', text: 'Thử lại' });
    retry.addEventListener('click', function () {
      closeModal();
      startSharing(true);
    });
    var steps;
    if (S.geo === 'insecure') {
      return [
        h('p', { text: 'Trình duyệt chỉ cho định vị trên trang dùng HTTPS. Hãy mở Gần Nhau bằng địa chỉ bắt đầu bằng https://.' }),
        h('p', { class: 'muted', text: 'Nếu bạn là người cài đặt máy chủ, hãy xem phần hướng dẫn trong README.' }),
      ];
    }
    if (S.geo === 'unavailable') return [h('p', { text: 'Thiết bị hoặc trình duyệt này không hỗ trợ định vị. Hãy thử Safari hoặc Chrome mới nhất.' })];
    if (IS_IOS) {
      steps = [
        'Trong Safari, bấm “aA” cạnh thanh địa chỉ, chọn Cài đặt trang web, rồi Vị trí → Cho phép.',
        'Nếu vẫn không được: Cài đặt → Quyền riêng tư & Bảo mật → Dịch vụ định vị. Bật lên, chọn Trang web của Safari, rồi chọn “Khi dùng ứng dụng”.',
      ];
    } else {
      steps = ['Bấm biểu tượng ổ khoá cạnh thanh địa chỉ, chọn Quyền → Vị trí → Cho phép.', 'Bật GPS của điện thoại trong Cài đặt → Vị trí.'];
    }
    return [
      h('p', { text: 'Trình duyệt đang chặn vị trí nên mọi người chưa thấy bạn. Bật lại theo cách sau rồi bấm Thử lại.' }),
      h('ol', { class: 'steps' }, steps.map(function (t) { return h('li', { text: t }); })),
      h('div', { class: 'stack' }, retry),
    ];
  }

  function sharingContent() {
    var pause = h('button', { class: 'btn btn-ghost', type: 'button', text: 'Tạm dừng chia sẻ' });
    pause.addEventListener('click', function () {
      closeModal();
      stopSharing();
      toast('Đã tạm dừng. Mọi người không thấy vị trí của bạn.');
    });
    var p = S.me;
    var facts = h(
      'div',
      { class: 'facts' },
      h('div', { class: 'fact' }, h('small', { text: 'Trạng thái' }), h('b', { text: S.geo === 'live' ? 'Trực tiếp' : 'Đang tìm GPS' })),
      h('div', { class: 'fact' }, h('small', { text: 'Độ chính xác' }), h('b', { text: p && p.acc ? '±' + Math.round(p.acc) + ' m' : '—' }))
    );
    return [
      h('p', { text: 'Mọi người trong nhóm đang thấy vị trí của bạn khi app này mở trên màn hình.' }),
      facts,
      h('div', { class: 'stack' }, pause),
    ];
  }

  function openShareModal() {
    if (!S.session) return;
    if (!S.sharing) return openModal('Chia sẻ vị trí của bạn?', h('div', null, consentContent()));
    if (S.geo === 'denied' || S.geo === 'insecure' || S.geo === 'unavailable') return openModal('Chưa định vị được', h('div', null, helpContent()));
    return openModal('Đang chia sẻ vị trí', h('div', null, sharingContent()));
  }

  function openMember(id) {
    var m = S.members.get(id);
    if (!m) return;
    var isMe = id === myId();
    var col = GN.COLORS[m.c % GN.COLORS.length];
    var now = serverNow();
    var v = memberView(m, now);
    var av = h('span', { class: 'av', text: GN.initial(m.name) });
    av.style.setProperty('--c', col.bg);
    av.style.setProperty('--fg', col.fg);
    var pos = isMe ? myPos() : m.sharing ? m.pos : null;
    var mine = myPos();
    var facts = [];
    if (pos && !isMe && mine) facts.push(['Cách bạn', GN.fmtDist(GN.distance(mine, pos))]);
    if (pos && !isMe) facts.push(['Cập nhật', GN.fmtAgo(now - pos.t)]);
    if (pos && GN.fmtSpeed(pos.spd)) facts.push(['Tốc độ', GN.fmtSpeed(pos.spd)]);
    if (pos && pos.acc) facts.push(['Độ chính xác', '±' + Math.round(pos.acc) + ' m']);
    var body = h(
      'div',
      null,
      h('div', { class: 'who' }, av, h('div', null, h('h3', { text: isMe ? m.name + ' (Bạn)' : m.name }), h('span', { text: v.sub }))),
      facts.length
        ? h('div', { class: 'facts' }, facts.map(function (f) { return h('div', { class: 'fact' }, h('small', { text: f[0] }), h('b', { text: f[1] })); }))
        : null
    );
    var stack = h('div', { class: 'stack' });
    if (pos) {
      stack.appendChild(
        h('button', {
          class: 'btn btn-ghost',
          type: 'button',
          text: 'Xem trên bản đồ',
          onclick: function () {
            closeModal();
            focusMember(id);
          },
        })
      );
      if (!isMe) directionsLinks(pos).forEach(function (a) { stack.appendChild(a); });
    } else if (isMe && !S.sharing) {
      stack.appendChild(h('button', { class: 'btn btn-primary', type: 'button', text: 'Bắt đầu chia sẻ', onclick: function () { closeModal(); openShareModal(); } }));
    }
    if (!isMe && (!pos || v.state === 'lost')) {
      stack.appendChild(
        h('button', {
          class: 'btn btn-danger',
          type: 'button',
          text: 'Xoá khỏi nhóm',
          onclick: async function () {
            try {
              await api('kick', auth({ target: id }));
              closeModal();
              toast('Đã xoá ' + m.name + ' khỏi nhóm');
            } catch (e) {
              toast(errText(e));
            }
          },
        })
      );
      stack.appendChild(h('p', { class: 'muted', text: 'Chỉ xoá được người đã ngắt kết nối vài phút. Họ mở lại app là tự vào lại nhóm.' }));
    }
    body.appendChild(stack);
    openModal(isMe ? 'Vị trí của bạn' : m.name, body);
  }

  // ---------------------------------------------------------------- khởi động

  function setupMapScreen() {
    $('#fab-rally').appendChild(icon('flag'));
    $('#fab-all').appendChild(icon('fit'));
    $('#fab-me').appendChild(icon('locate'));
    $('#btn-menu').appendChild(icon('gear'));
    $('#btn-menu').addEventListener('click', openSettings);
    $('#chip-group').addEventListener('click', openInvite);
    $('#btn-invite').addEventListener('click', openInvite);
    $('#status-pill').addEventListener('click', openShareModal);
    $('#fab-rally').addEventListener('click', function () {
      if (S.rally) openRally();
      else startPicking();
    });
    $('#fab-all').addEventListener('click', function () {
      setMode('all');
      S.lastFit = 0;
      fitAll();
    });
    $('#fab-me').addEventListener('click', function () {
      if (!myPos()) {
        if (!S.sharing) openShareModal();
        else toast('Đang tìm vị trí của bạn…');
        return;
      }
      setMode('me');
      S.lastFollow = 0;
      applyCamera();
    });
    setupSheet();
  }

  function boot() {
    loadSettings();
    setupWelcome();
    setupMapScreen();
    var invite = '';
    try {
      invite = GN.normCode(new URLSearchParams(location.search).get('g'));
    } catch (e) {
      invite = '';
    }
    var saved = loadSession();
    if (saved && (!invite || invite === saved.code)) {
      S.session = saved;
      enterMap();
    } else {
      // Có lời mời vào nhóm khác: giữ nhóm cũ cho tới khi người dùng vào nhóm mới thành công
      S.previous = saved;
      showWelcome(invite.length === 8 ? invite : '');
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('/sw.js').catch(noop);
    }
  }

  boot();
})();
