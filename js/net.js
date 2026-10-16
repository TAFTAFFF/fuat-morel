/* FUAT MOREL — net.js : sunucusuz çok oyunculu ağ katmanı (MULTIPLAYER.md bölüm 1).
   Herkese açık MQTT aracıları üzerinden (WebSocket, alt protokol 'mqtt', ikili çerçeve) kendi minimal MQTT 3.1.1 istemcimiz +
   oda protokolü: oda kodu, lobi (retain), katılma kabulü (en fazla 10), canlılık/ping, ev sahibi göçü, sürüm kontrolü,
   durum anlık görüntüsü akışı (~10 Hz) + alıcıda zaman damgalı ara değerleme tamponu, olay kanalı, ev sahibi kontrol mesajları, emoji.
   SADECE AĞ: oyun mantığına dokunmaz. Tüm API FM.net altında; bildirimler FM.emit('net:...') ile.
   Hiçbir exception dışarı sızmaz (her giriş noktası try/catch). Oda işlemi yapılmadıkça hiçbir bağlantı/zamanlayıcı açılmaz. */
'use strict';
(function (FM) {
  if (!FM) return;
  if (typeof FM.NET_VER !== 'number') FM.NET_VER = 1;   // ağ protokolü sürümü: uyumsuz değişiklikte artır
  const VER = FM.NET_VER;

  /* =================== sabitler =================== */
  // Dizideki SIRA oda koduna gömülen indekstir — DEĞİŞTİRME (eski kodlar bozulur). Tercih sırası PREF'te.
  // win: herhangi 1 sn'lik pencerede en fazla yayın (istemcinin kendine koyduğu sınır), res: durum dışı mesajlara ayrılan pay,
  // stMs: durum yayını aralığı.
  // Ölçüm (2026-10-16, bu bilgisayar): herkese açık EMQX istemci başına 1 sn'de ~10 mesajdan fazlasını SESSİZCE atıyor
  // (12'lik anlık patlamadan 10'u, 30 Hz'den ~10/sn geçti); Mosquitto ve HiveMQ 30 Hz'de kayıpsız.
  // Gecikme (oda içi tek yön, ort.): Mosquitto ~90 ms, EMQX ~180 ms. Bu yüzden tercih: Mosquitto → EMQX → HiveMQ.
  const BROKERS = [
    { n: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt', win: 9, res: 1, stMs: 150 },
    { n: 'Mosquitto', url: 'wss://test.mosquitto.org:8081/mqtt', win: 40, res: 3, stMs: 100 },
    { n: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt', win: 40, res: 3, stMs: 100 }
  ];
  const PREF = [1, 0, 2];          // oda kurarken deneme sırası ve yedekleme sırası
  // Geliştirici/test: ?brokerUrl=ws://127.0.0.1:PORT/mqtt → TÜM aracılar bu adrese gider (yerel test aracısı dev/broker.js).
  // Yalnızca parametre açıkça verilince; ?dev=1 yoksa yalnız yerel ağ adresleri kabul edilir (yabancı bir linkle oyun başka aracıya yönlenmesin).
  const OVR = (function () {
    try {
      const u = FM.params && FM.params.brokerUrl; if (typeof u !== 'string' || !u || u.length > 300) return null;
      const x = new URL(u); if (x.protocol !== 'ws:' && x.protocol !== 'wss:') return null;
      const h = x.hostname.replace(/^\[|\]$/g, '');
      const local = h === 'localhost' || h === '::1' || /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
      return (FM.DEV || local) ? x.href : null;
    } catch (e) { return null; }
  })();
  if (OVR) for (const b of BROKERS) { b.url = OVR; b.n = 'Yerel'; b.win = 40; b.res = 3; b.stMs = 100; }
  const ROOT = 'fuatmorel/v1/';
  const MAXP = 10;                 // odadaki en fazla insan oyuncu
  const KEEP = 20;                 // MQTT keepalive (sn)
  const PING_MS = 2000;            // canlılık pingi
  const DROP_MS = 6000;            // bu kadar sessizlik = düştü
  const SILENT_MS = 9000;          // odadayken kendi yankımız bile gelmiyorsa bağlantı ölü
  const STATE_MS = 100;            // durum yayını aralığı (~10 Hz)
  const BUF_MS = 1000;             // ara değerleme tamponu (son ~1 sn)
  const EXTRA_MS = 90;             // en yeni örnekten sonra en fazla bu kadar doğrusal öngörü
  const JOIN_RESEND = 2000, JOIN_TIMEOUT = 9000, JOIN_TIMEOUT_ALIVE = 16000, JOIN_TIMEOUT_EMPTY = 4500;
  const CONNECT_TIMEOUT = 6000;     // CONNACK bu sürede gelmezse bu denemeyi bırak (HiveMQ bazen bağlantıyı askıda bırakıyor)
  const SETTLE_MS = 1500;          // (yeniden) abone olunca ev sahibi, retain lobiyi bu kadar bekler
  const RECLAIM_MS = 2500;         // katılırken lobide ev sahibi biz görünüyorsak eski oturumun yanıtını bu kadar bekle, sonra geri al
  const RJ_KEY = 'fm-oda', RJ_MAX = 15 * 60000, RJ_LIVE_MS = 10000;   // "odaya geri dön" kaydı: 15 dk geçerli, odadayken 10 sn'de bir tazelenir
  const BACKOFF = [300, 1000, 2000, 4000, 8000, 12000];
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 karakter: O/0/I/1 yok
  const ID_CH = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const ERR = {
    badcode: 'Oda kodu geçersiz. 5 karakterli kodu kontrol et.',
    noroom: 'Oda bulunamadı ya da kapandı.',
    full: 'Oda dolu (en fazla 10 oyuncu).',
    ver: 'Oyun sürümü farklı. Sayfayı yenile.',
    conn: 'Sunucuya bağlanılamadı. İnternet bağlantını kontrol et.',
    nows: 'Bu tarayıcı çok oyunculu modu desteklemiyor.',
    dup: 'Bu odaya başka bir sekmeden ya da cihazdan girildi.',
    kicked: 'Ev sahibi seni odadan çıkardı.'
  };

  /* =================== yardımcılar =================== */
  const now = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();
  const logBuf = [];
  function log() {
    try {
      const parts = []; for (let i = 0; i < arguments.length; i++) parts.push(typeof arguments[i] === 'string' ? arguments[i] : JSON.stringify(arguments[i]));
      const line = (now() / 1000).toFixed(2) + ' ' + parts.join(' ');
      logBuf.push(line); if (logBuf.length > 250) logBuf.splice(0, logBuf.length - 250);
      if (FM.net && FM.net.debug) console.log('[net] ' + line);
    } catch (e) { }
  }
  function guard(fn, name, def) {
    return function () { try { return fn.apply(this, arguments); } catch (e) { log('HATA ' + name + ': ' + (e && e.stack || e)); return def; } };
  }
  function emit(evt, data) { try { if (typeof FM.emit === 'function') FM.emit(evt, data); } catch (e) { } }
  function rnd(n, chars) {
    chars = chars || ID_CH; let a = null, s = '';
    try { if (typeof crypto !== 'undefined' && crypto && crypto.getRandomValues) { a = new Uint8Array(n); crypto.getRandomValues(a); } } catch (e) { a = null; }
    for (let i = 0; i < n; i++) s += chars[(a ? a[i] : Math.floor(Math.random() * 256)) % chars.length];
    return s;
  }
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // tablo anahtarı mı? (yalnız KENDİ alanı: ağdan gelen '__proto__' / 'constructor' gibi adlar geçemez)
  const own = (T, k) => typeof k === 'string' && !!T && Object.prototype.hasOwnProperty.call(T, k);
  const isChar = c => own(FM.CH, c);
  const str = (v, max, def) => (typeof v === 'string' && v.length <= max) ? v : def;
  // kısa kimlik/anahtar. Nesne anahtarı olarak kullanılır: '__proto__', 'constructor' gibi adlar REDDEDİLİR (prototip kirletme)
  const tok = (v, def) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,24}$/.test(v) && !(v in Object.prototype)) ? v : def;
  function cleanNick(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f<>"'`\\]/g, '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, 14).join('').trim();
  }
  function clone(o) { try { return JSON.parse(JSON.stringify(o)); } catch (e) { return null; } }

  /* ---- UTF-8 ---- */
  const TE = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const TD = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  function utf8(s) {
    s = String(s);
    if (TE) return TE.encode(s);
    const b = unescape(encodeURIComponent(s)), u = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i);
    return u;
  }
  function fromUtf8(u) {
    if (TD) return TD.decode(u);
    let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
  }

  /* =================== kimlik (FM.save.pid / FM.save.nick) =================== */
  let keptPid = null;
  function ensureId() {
    const sv = FM.save; if (!isObj(sv)) return;
    let ch = false;
    if (typeof sv.pid !== 'string' || !/^[a-z0-9]{4,16}$/.test(sv.pid)) {
      // kayıt kaybolduysa "odaya geri dön" kaydındaki kimlik (ev sahibi aynı oyuncu olarak tanısın)
      let rp = null; try { const o = JSON.parse(lsGet(RJ_KEY) || 'null'); if (o && typeof o.pid === 'string' && /^[a-z0-9]{4,16}$/.test(o.pid)) rp = o.pid; } catch (e) { rp = null; }
      sv.pid = keptPid || rp || ('p' + rnd(9)); ch = true;
    }
    keptPid = sv.pid;
    if (typeof sv.nick !== 'string' || !cleanNick(sv.nick)) {
      const base = cleanNick(isChar(sv.selChar) ? sv.selChar : '') || 'Oyuncu';
      sv.nick = base; sv.nickSet = false; ch = true;
    } else if (typeof sv.nickSet !== 'boolean') { sv.nickSet = true; ch = true; }
    if (ch && typeof FM.persist === 'function') FM.persist();
  }
  function myPid() { if (!FM.save || typeof FM.save.pid !== 'string') ensureId(); return (FM.save && FM.save.pid) || keptPid || 'p0'; }
  function myNick() { const n = FM.save && cleanNick(FM.save.nick); return n || 'Oyuncu'; }
  const SN = rnd(5);   // oturum (sayfa yüklemesi) kimliği: aynı pid'li eski oturumların mesajlarını ayırt eder

  /* =================== oda kodu =================== */
  function checkIdx(i4) { return (i4[0] * 1 + i4[1] * 3 + i4[2] * 5 + i4[3] * 7 + 11) % 8; }
  function makeCode(rand4, bi) {
    const i4 = []; for (let i = 0; i < 4; i++) i4.push(ALPHA.indexOf(rand4[i]));
    return rand4 + ALPHA[checkIdx(i4) * 4 + (bi & 3)];
  }
  // Serbest metinden (kod ya da link) oda kodu çıkarır. Geçerliyse {code, broker}, değilse null.
  function parseCode(input) {
    let s = String(input == null ? '' : input);
    const m = s.match(/[?&#]oda=([^&#\s]*)/i); if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
    s = s.replace(/İ/g, 'I').replace(/ı/g, 'I').toUpperCase().replace(/[\s\-_.]/g, '');
    if (s.length !== 5) return null;
    const i5 = []; for (let i = 0; i < 5; i++) { const k = ALPHA.indexOf(s[i]); if (k < 0) return null; i5.push(k); }
    const bi = i5[4] & 3, ck = i5[4] >> 2;
    if (ck !== checkIdx(i5) || bi >= BROKERS.length) return null;
    return { code: s, broker: bi };
  }

  /* =================== minimal MQTT 3.1.1 istemcisi =================== */
  function encLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; }
  function mqStr(u) { const o = new Uint8Array(2 + u.length); o[0] = u.length >> 8; o[1] = u.length & 255; o.set(u, 2); return o; }
  function packet(h, parts) {
    let n = 0; for (const p of parts) n += p.length;
    const rl = encLen(n), out = new Uint8Array(1 + rl.length + n);
    out[0] = h; out.set(rl, 1); let o = 1 + rl.length;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const MAX_PKT = 256 * 1024;

  // o: {cid, keep, will:{topic, payload}|null, onOpen(), onClose(reason, wasOpen), onMsg(topic, Uint8Array, retain)}
  function Mq(url, o) {
    this.url = url; this.o = o; this.ws = null; this.buf = null; this.ok = false; this.done = false;
    this.pid = 1; this.lastRx = now(); this.lastTx = now(); this.probeAt = 0; this.t0 = now(); this.timer = null;
  }
  Mq.prototype.open = function () {
    const self = this;
    try { this.ws = new WebSocket(this.url, ['mqtt']); } catch (e) { setTimeout(() => self.end('ws ' + (e && e.message)), 0); return; }
    try { this.ws.binaryType = 'arraybuffer'; } catch (e) { }
    this.ws.onopen = guard(function () {
      if (self.done) return;
      self.wsOpen = true;
      const o = self.o, w = o.will && o.will.topic;
      const flags = 0x02 | (w ? 0x04 : 0);   // clean session (+ will, QoS0, retain yok)
      const parts = [mqStr(utf8('MQTT')), new Uint8Array([4, flags, (o.keep >> 8) & 255, o.keep & 255]), mqStr(utf8(o.cid))];
      if (w) { parts.push(mqStr(utf8(o.will.topic))); parts.push(mqStr(utf8(o.will.payload || ''))); }
      self.raw(packet(0x10, parts));
    }, 'ws.onopen');
    this.ws.onmessage = guard(function (ev) { if (!self.done) self.feed(ev.data); }, 'ws.onmessage');
    this.ws.onerror = function () { };
    this.ws.onclose = guard(function (ev) { self.end('kapandı ' + (ev && ev.code)); }, 'ws.onclose');
    this.timer = setTimeout(guard(function () { if (!self.ok) self.end('zaman aşımı (' + (self.wsOpen ? 'CONNACK yok' : 'WebSocket açılmadı') + ')'); }, 'mq.timeout'), CONNECT_TIMEOUT);
  };
  Mq.prototype.raw = function (u) {
    const ws = this.ws; if (!ws || ws.readyState !== 1) return false;
    try { ws.send(u); this.lastTx = now(); return true; } catch (e) { return false; }
  };
  Mq.prototype.feed = function (data) {
    if (typeof data === 'string' || !data) return;
    this.lastRx = now();
    let u;
    try { u = new Uint8Array(data); } catch (e) { return; }
    if (this.buf && this.buf.length) { const c = new Uint8Array(this.buf.length + u.length); c.set(this.buf, 0); c.set(u, this.buf.length); u = c; }
    let off = 0;
    for (;;) {
      if (u.length - off < 2) break;
      let len = 0, mul = 1, i = off + 1, fin = false;
      for (let k = 0; k < 4 && i < u.length; k++) { const b = u[i++]; len += (b & 127) * mul; mul *= 128; if (!(b & 128)) { fin = true; break; } }
      if (!fin) { if (i - off - 1 >= 4) { this.end('bozuk çerçeve'); return; } break; }   // ya bozuk ya eksik
      if (len > MAX_PKT) { this.end('çok büyük paket'); return; }
      if (i + len > u.length) break;          // paketin geri kalanı sonraki WS mesajında
      this.handle(u[off], u.subarray(i, i + len));
      if (this.done) return;
      off = i + len;
    }
    this.buf = off < u.length ? u.slice(off) : null;
  };
  Mq.prototype.handle = function (h, b) {
    const type = h >> 4;
    if (type === 2) {                                   // CONNACK
      if (b.length < 2 || b[1] !== 0) { this.end('CONNACK red ' + (b[1] | 0)); return; }
      this.ok = true; clearTimeout(this.timer); this.timer = null;
      try { this.o.onOpen(); } catch (e) { log('HATA onOpen ' + (e && e.stack || e)); }
    } else if (type === 3) {                            // PUBLISH
      if (b.length < 2) return;
      const qos = (h >> 1) & 3, retain = !!(h & 1), tl = (b[0] << 8) | b[1];
      if (2 + tl > b.length) return;
      const topic = fromUtf8(b.subarray(2, 2 + tl)); let p = 2 + tl;
      if (qos > 0) {
        if (p + 2 > b.length) return;
        const id = new Uint8Array([b[p], b[p + 1]]); p += 2;
        if (qos === 1) this.raw(packet(0x40, [id])); else if (qos === 2) this.raw(packet(0x50, [id]));
      }
      try { this.o.onMsg(topic, b.subarray(p), retain); } catch (e) { log('HATA onMsg ' + (e && e.stack || e)); }
    } else if (type === 6) {                            // PUBREL (QoS2 akışı; normalde gelmez)
      if (b.length >= 2) this.raw(packet(0x70, [new Uint8Array([b[0], b[1]])]));
    } else if (type === 9) {                            // SUBACK
      for (let i = 2; i < b.length; i++) if (b[i] === 0x80) log('abonelik reddedildi');
    }
    // 11 UNSUBACK, 13 PINGRESP: lastRx güncellendi, başka iş yok
  };
  Mq.prototype.nextId = function () { this.pid = (this.pid % 65535) + 1; return new Uint8Array([this.pid >> 8, this.pid & 255]); };
  Mq.prototype.publish = function (topic, payload, retain, droppable) {
    if (!this.ok || this.done) return false;
    const ws = this.ws;
    if (droppable && ws && ws.bufferedAmount > 64 * 1024) return false;   // yavaş hat: durum paketlerini at, olayları değil
    const t = utf8(topic), p = typeof payload === 'string' ? utf8(payload) : (payload || new Uint8Array(0));
    return this.raw(packet(0x30 | (retain ? 1 : 0), [mqStr(t), p]));
  };
  Mq.prototype.subscribe = function (filter) { if (!this.ok) return false; return this.raw(packet(0x82, [this.nextId(), mqStr(utf8(filter)), new Uint8Array([0])])); };
  Mq.prototype.unsubscribe = function (filter) { if (!this.ok) return false; return this.raw(packet(0xA2, [this.nextId(), mqStr(utf8(filter))])); };
  Mq.prototype.ping = function () { return this.raw(new Uint8Array([0xC0, 0])); };
  Mq.prototype.probe = function () { if (this.ok) { this.probeAt = now(); this.ping(); } };
  Mq.prototype.tick = function (t) {
    if (this.done || !this.ok) return;
    if (t - this.lastTx > KEEP * 500) this.ping();                                 // keepalive
    if (t - this.lastRx > KEEP * 1500) { this.end('keepalive'); return; }        // aracı sessiz
    if (this.probeAt && this.lastRx < this.probeAt && t - this.probeAt > 3500) { this.end('yoklama yanıtsız'); return; }
    if (this.probeAt && this.lastRx >= this.probeAt) this.probeAt = 0;
  };
  Mq.prototype.disconnect = function () {          // temiz çıkış: DISCONNECT → Last Will yayınlanmaz
    if (this.done) return;
    this.raw(new Uint8Array([0xE0, 0]));
    this.end('çıkış', true);
  };
  Mq.prototype.end = function (reason, quiet) {
    if (this.done) return;
    this.done = true; clearTimeout(this.timer); this.timer = null;
    const ws = this.ws;
    if (ws) { ws.onopen = ws.onmessage = ws.onclose = null; ws.onerror = function () { }; try { if (ws.readyState < 2) ws.close(); } catch (e) { } }
    this.buf = null;
    if (!quiet) { try { this.o.onClose(reason, this.ok); } catch (e) { log('HATA onClose ' + (e && e.stack || e)); } }
  };

  /* =================== bağlantı yöneticisi (aracı yedekleme + üstel geri çekilme) =================== */
  const C = { mq: null, conn: 'idle', bi: -1, order: [0, 1, 2], per: 1, att: 0, timer: null, want: false, persistent: false, cn: '', openAt: 0 };
  function connected() { return !!(C.mq && C.mq.ok && !C.mq.done); }
  function setConn(s) { if (C.conn !== s) { C.conn = s; statusChanged(); } }
  // önce odanın aracısı, sonra PREF sırasıyla diğerleri (herkes aynı sırayı izler → kopan oda aynı yedekte buluşur)
  function orderFrom(bi) { const o = [bi]; for (const i of PREF) if (i !== bi) o.push(i); return o; }
  function startConnect(pref, per, persistent) {
    stopConnect();
    C.order = orderFrom(pref); C.per = per; C.att = 0; C.want = true; C.persistent = persistent;
    attempt();
  }
  function stopConnect(clean) {
    C.want = false; clearTimeout(C.timer); C.timer = null;
    const m = C.mq; C.mq = null;
    if (m) { if (clean) m.disconnect(); else m.end('durdur', true); }
  }
  const attempt = guard(function () {
    C.timer = null;
    if (!C.want) return;
    if (typeof WebSocket === 'undefined') { failRoom('nows'); return; }
    const bi = C.order[Math.floor(C.att / C.per) % C.order.length];
    C.bi = bi; C.cn = rnd(5);
    if (R.phase === 'creating') { R.code = makeCode(R.rand4, bi); R.base = ROOT + R.code + '/'; }
    setConn(R.everIn ? 'reconnecting' : 'connecting');
    const pid = myPid();
    const will = R.base ? { topic: R.base + 'bye/' + pid, payload: JSON.stringify({ f: pid, sn: SN, cn: C.cn, w: 1 }) } : null;
    log('bağlanıyor', BROKERS[bi].n, 'deneme', C.att);
    const m = new Mq(BROKERS[bi].url, { cid: 'fm' + pid + C.cn, keep: KEEP, will, onOpen: () => { if (C.mq === m) onOpen(); }, onClose: (r, was) => { if (C.mq === m) onClose(r, was); }, onMsg: (t, p, r) => { if (C.mq === m) onMsg(t, p, r); } });
    C.mq = m; m.open();
  }, 'attempt');
  function onClose(reason, wasOpen) {
    log('bağlantı kapandı:', reason, 'açıktı', wasOpen);
    C.mq = null; Q.q.length = 0;
    pRoomClosed();
    if (!C.want) { setConn('idle'); return; }
    const short = wasOpen && now() - C.openAt < 5000;            // açılıp hemen kapandı: başarısız say
    const offline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;
    if ((!wasOpen || short) && !offline) C.att++;
    if (!C.persistent && C.att >= C.order.length * C.per) { failRoom('conn'); return; }
    setConn(R.everIn ? 'reconnecting' : 'connecting');
    const d = BACKOFF[Math.min(C.att, BACKOFF.length - 1)] * (0.85 + Math.random() * 0.3);
    clearTimeout(C.timer); C.timer = setTimeout(attempt, (wasOpen && !short) ? 250 : d);
  }
  function reconnectNow(why) {
    if (!C.want) return;
    log('hemen yeniden bağlan:', why);
    clearTimeout(C.timer); C.timer = null;
    const m = C.mq; C.mq = null; if (m) m.end(why, true);
    attempt();
  }

  /* =================== "odaya geri dön" kaydı (TUR5 §7) ===================
     localStorage['fm-oda'] = {code, broker, t (son odada olma ms), pid, hn (ev sahibinin adı), live (odadayken 10 sn'de bir), closed (pagehide ms)}.
     Sayfa yenilenir / uygulama kapanıp açılırsa 15 dk içinde aynı odaya otomatik dönülür (netgame.js). Bilerek çıkınca silinir. */
  function lsGet(k) { try { return typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem(k) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(k, v); } catch (e) { } }
  function lsDel(k) { try { if (typeof localStorage !== 'undefined' && localStorage) localStorage.removeItem(k); } catch (e) { } }
  const fin = v => typeof v === 'number' && isFinite(v);
  function rjRead() {
    let o = null; try { o = JSON.parse(lsGet(RJ_KEY) || 'null'); } catch (e) { o = null; }
    if (!isObj(o) || !fin(o.t)) return null;
    const pc = parseCode(o.code); if (!pc) return null;
    return { code: pc.code, broker: fin(o.broker) && o.broker >= 0 && o.broker < BROKERS.length ? o.broker | 0 : pc.broker, t: o.t,
      pid: tok(o.pid, null), hn: cleanNick(o.hn) || null, live: fin(o.live) ? o.live : 0, closed: fin(o.closed) ? o.closed : 0, host: !!o.host };
  }
  function rjWrite(extra) {
    if (R.phase !== 'in' || !R.code) return;
    const h = entry(R.hostPid), t = Date.now();
    const o = { code: R.code, broker: C.bi >= 0 ? C.bi : (R.codeBi >= 0 ? R.codeBi : 0), t, pid: myPid(), hn: h ? h.n : '', live: t, closed: 0, host: R.role === 'host' ? 1 : 0 };
    if (isObj(extra)) Object.assign(o, extra);
    lsSet(RJ_KEY, JSON.stringify(o)); R.rjT = now();
  }
  function rjClear(code) { const o = rjRead(); if (!code || !o || o.code === code) lsDel(RJ_KEY); }
  // geçerli kayıt (15 dk içinde, bu kimlikle) ya da null
  function lastRoom() {
    const o = rjRead(); if (!o) return null;
    const age = Date.now() - o.t;
    if (age < -60000 || age > RJ_MAX || (o.pid && o.pid !== myPid())) return null;
    return o;
  }

  /* =================== oda durumu =================== */
  const R = {
    phase: null,        // null | 'creating' | 'joining' | 'in'
    role: null,         // 'host' | 'member'
    code: null, base: null, rand4: null, everIn: false,
    lob: null,          // lobi nesnesi (ev sahibinde yetkili kopya, üyede son kabul edilen)
    hostPid: null, kSeq: 0, provT: 0,
    seen: {},           // pid -> son haber (yerel ms)
    info: {},           // pid -> {rtt, cn, sn}
    rtt: 0, rttN: 0,
    lastPing: 0, joinT0: 0, joinLast: 0, pingSeen: false, sawRetained: false,
    settleUntil: 0, pubTimer: null, lastPub: 0, lastContest: 0,
    ctlSeen: [], pendLocal: {},
    prof: {}, ready: false,
    pend: null, stTimer: null, lastState: 0,
    evTok: 30, evT: 0, emoT: 0,
    tickTimer: null, lastTick: 0, hiddenAt: 0, suspended: false,
    plSig: '', plT: 0, statusSig: ''
  };
  const bufs = {};       // varlık id -> {src, arr:[{t, d}], last}
  const offs = {};       // gönderen pid -> {off, jit, iv, dly, lastSt}

  function alive(id) {
    if (id === myPid()) return connected();
    const t = R.seen[id]; return typeof t === 'number' && now() - t < DROP_MS;
  }
  function seen(id) { if (typeof id === 'string') R.seen[id] = now(); }
  function inLobby(id) { return !!(R.lob && R.lob.p.find(p => p.id === id)); }
  function entry(id) { return R.lob ? R.lob.p.find(p => p.id === id) || null : null; }

  /* ---- yayın bütçesi (kayan 1 sn pencere): aracının hız sınırını aşıp mesaj kaybetmemek için ----
     önemli mesajlar (ctl, ev, lobby, join, ping) pencere doluysa SIRAYA girer (kaybolmaz, en fazla ~birkaç yüz ms gecikir);
     durum anlık görüntüleri yalnızca pencerede 'res' kadar yer kalıyorsa gider (yoksa atlanır, az sonra en güncel durum gider). */
  const Q = { sent: [], q: [], timer: null };
  function bk() { return BROKERS[C.bi >= 0 && C.bi < BROKERS.length ? C.bi : 0]; }
  function used(t) { const a = Q.sent; while (a.length && t - a[0] >= 1000) a.shift(); return a.length; }
  function qReset() { clearTimeout(Q.timer); Q.timer = null; Q.q.length = 0; Q.sent.length = 0; }
  function schedDrain() { if (Q.timer) return; const t = now(); Q.timer = setTimeout(drain, Q.sent.length ? Math.max(10, Math.ceil(Q.sent[0] + 1000 - t) + 5) : 10); }
  function send(topic, payload, retain, droppable) { const ok = C.mq.publish(topic, payload, retain, droppable); if (ok) Q.sent.push(now()); return ok; }
  const drain = guard(function () {
    Q.timer = null;
    if (!connected()) { Q.q.length = 0; return; }
    const win = bk().win;
    while (Q.q.length && used(now()) < win) { const m = Q.q.shift(); send(m[0], m[1], m[2], false); }
    if (Q.q.length) schedDrain();
  }, 'drain');
  // kind: undefined = önemli (sıraya girer), 'st' = durum (bütçe yoksa false), 'now' = beklemeden (çıkış anı)
  function pub(sub, obj, retain, kind) {
    if (!connected() || !R.base) return false;
    const payload = obj === '' ? '' : (typeof obj === 'string' ? obj : JSON.stringify(obj));
    const topic = R.base + sub, b = bk(), u = used(now());
    if (kind === 'now') return send(topic, payload, !!retain, false);
    if (kind === 'st') { if (Q.q.length || u + 1 + b.res > b.win) return false; return send(topic, payload, false, true); }
    if (Q.q.length || u >= b.win) { if (Q.q.length >= 80) Q.q.shift(); Q.q.push([topic, payload, !!retain]); schedDrain(); return true; }
    return send(topic, payload, !!retain, false);
  }

  function myProfile() {
    const sv = FM.save || {}, P = R.prof || {};
    const c = isChar(P.char) ? P.char : (isChar(sv.selChar) ? sv.selChar : 'TAFTAF');
    const eq = isObj(sv.equipped) ? sv.equipped : {};
    return {
      n: cleanNick(P.nick) || myNick(), c,
      sk: tok(P.skin, '') || (isObj(eq.skin) && tok(eq.skin[c], '')) || 'klasik',
      tr: tok(P.trail, '') || tok(eq.trail, '') || 'dust',
      pl: tok(P.plate, '') || tok(eq.plate, '') || 'basic'
    };
  }
  function sanitizeEntry(p) {
    if (!isObj(p) || !tok(p.id, null)) return null;
    return {
      id: p.id, n: cleanNick(p.n) || 'Oyuncu', c: isChar(p.c) ? p.c : 'TAFTAF',
      sk: tok(p.sk, 'klasik'), tr: tok(p.tr, 'dust'), pl: tok(p.pl, 'basic'),
      rd: p.rd ? 1 : 0, w: p.w ? 1 : 0, o: p.o ? 1 : 0, sn: tok(p.sn, '')
    };
  }
  function sanitizeLobby(L) {
    if (!isObj(L) || !tok(L.h, null) || !Array.isArray(L.p)) return null;
    const out = {
      v: L.v, h: L.h, e: (typeof L.e === 'number' && isFinite(L.e)) ? L.e | 0 : 0,
      st: (L.st === 'race' || L.st === 'results') ? L.st : 'lobby',
      cfg: isObj(L.cfg) ? L.cfg : {}, p: [], x: Array.isArray(L.x) ? L.x.filter(s => tok(s, null)).slice(0, 30) : [],
      ck: str(L.ck, 64, ''), cl: (isObj(L.cl) && typeof L.cl.t === 'string') ? { t: L.cl.t, d: isObj(L.cl.d) ? L.cl.d : {} } : null,
      ts: typeof L.ts === 'number' ? L.ts : 0
    };
    for (const p of L.p.slice(0, MAXP + 4)) { const e = sanitizeEntry(p); if (e && !out.p.find(q => q.id === e.id)) out.p.push(e); }
    return out;
  }

  /* ---------------- durum bildirimleri ---------------- */
  function statusObj() {
    return {
      conn: C.conn, phase: R.phase, room: R.code, role: R.role, inRoom: R.phase === 'in',
      host: R.hostPid, me: myPid(), broker: C.bi, brokerName: C.bi >= 0 ? BROKERS[C.bi].n : '', rtt: Math.round(R.rtt)
    };
  }
  function statusChanged() {
    const s = statusObj(), sig = [s.conn, s.phase, s.room, s.role, s.host, s.broker].join('|');
    if (sig === R.statusSig) return; R.statusSig = sig;
    emit('net:status', s);
    pSoon();
  }
  function playersList() {
    const L = R.lob; if (!L) return [];
    const me = myPid();
    return L.p.map((p, i) => {
      const inf = R.info[p.id];
      return {
        pid: p.id, nick: p.n, char: p.c, skin: p.sk, trail: p.tr, plate: p.pl,
        ready: !!p.rd, waiting: !!p.w, off: !!p.o, host: p.id === R.hostPid, me: p.id === me,
        alive: alive(p.id), ping: p.id === me ? (R.rttN ? Math.round(R.rtt) : null) : (inf && typeof inf.rtt === 'number' ? Math.round(inf.rtt) : null), idx: i
      };
    });
  }
  function lobbyView() {
    const L = R.lob; if (!L) return null;
    return { code: R.code, host: R.hostPid, me: myPid(), isHost: R.role === 'host', st: L.st, cfg: clone(L.cfg) || {}, epoch: L.e, v: L.v, players: playersList(), max: MAXP };
  }
  function emitLobby() { if (R.phase !== 'in') return; emit('net:lobby', lobbyView()); emitPlayers(true); pSoon(); }
  function emitPlayers(force) {
    if (R.phase !== 'in') return;
    const pl = playersList();
    const sig = pl.map(p => [p.pid, p.nick, p.char, p.skin, p.ready, p.waiting, p.off, p.host, p.alive, p.ping == null ? '-' : Math.round(p.ping / 25)].join(',')).join(';');
    const t = now();
    if (!force && (sig === R.plSig || t - R.plT < 450)) return;
    R.plSig = sig; R.plT = t;
    emit('net:players', { code: R.code, players: pl });
  }
  function error(code, extra) { const e = Object.assign({ code, msg: ERR[code] || 'Bağlantı hatası.' }, extra || {}); log('hata', code); emit('net:error', e); }

  /* ---------------- oda yaşam döngüsü ---------------- */
  function resetRoom() {
    clearTimeout(R.pubTimer); clearTimeout(R.stTimer); clearTimeout(Q.timer); Q.timer = null; Q.q.length = 0;
    for (const k in R.pendLocal) clearTimeout(R.pendLocal[k]);
    if (R.tickTimer) { clearInterval(R.tickTimer); R.tickTimer = null; }
    Object.assign(R, {
      phase: null, role: null, code: null, base: null, rand4: null, everIn: false, lob: null, hostPid: null, kSeq: 0, provT: 0,
      seen: {}, info: {}, lastPing: 0, joinT0: 0, joinLast: 0, pingSeen: false, sawRetained: false, settleUntil: 0, codeBi: -1, joinRetry: 0,
      pubTimer: null, lastPub: 0, lastContest: 0, ctlSeen: [], pendLocal: {}, ready: false, pend: null, stTimer: null, lastState: 0,
      suspended: false, plSig: '', statusSig: R.statusSig, needPub: false, cfg0: null, rejoin: false, reclaim: null, reclaimT: 0, otherMe: 0, rjT: 0
    });
    for (const k in bufs) delete bufs[k];
    for (const k in offs) delete offs[k];
  }
  function startTick() {
    if (R.tickTimer || typeof setInterval !== 'function') return;
    R.lastTick = now();
    R.tickTimer = setInterval(tick, 500);
  }
  // oda bağlantısını kapat + oda durumunu sıfırla (varlık kendi bağlantısına geçer)
  function endRoom() {
    stopConnect(true); resetRoom(); setConn('idle'); statusChanged();
    try { pRoute(); } catch (e) { log('HATA pRoute ' + (e && e.stack || e)); }
  }
  // kalıcı hatalarda (oda yok, dolu, sürüm, atıldın) "odaya geri dön" kaydı silinir; bağlantı hatasında kalır (tekrar denenebilir)
  const RJ_DROP = { noroom: 1, full: 1, ver: 1, kicked: 1, badcode: 1 };
  function failRoom(code) {
    const wasIn = R.phase === 'in', rj = !!R.rejoin, rc = R.code;
    if (RJ_DROP[code]) rjClear(rc);
    endRoom();
    error(code, rj ? { wasIn, rejoin: true, room: rc } : { wasIn });
  }
  // involuntary = sayfa kapanıyor/yenileniyor (pagehide): kullanıcı odadan ÇIKMADI → geri dönüş kaydı kalır;
  // yarış sürüyorsa devirde kendi kaydımız 'koptu' olarak kalır (dönünce aynı yarışçı); yalnız ev sahibiysek retain lobi SİLİNMEZ
  // (15 dk içinde geri gelince oda bizimle sürer; gelmezsek ilk katılma denemesi bayat lobiyi temizler).
  function leave(quietBye, involuntary) {
    if (!R.phase) return;
    const me = myPid();
    if (connected() && R.phase === 'in') {
      if (R.role === 'host' && R.lob) {
        const others = R.lob.p.filter(p => p.id !== me && !p.o && alive(p.id)).map(p => p.id).sort();
        if (!others.length) { if (!involuntary) pub('lobby', '', true, 'now'); }   // son kişi: retain lobiyi temizle (oda kapanır)
        else {                                                         // devir: en küçük pid ev sahibi olur
          const L = clone(R.lob); L.h = others[0]; L.e = (L.e | 0) + 1; L.ts = Date.now();
          if (involuntary && L.st !== 'lobby') { for (const p of L.p) if (p.id === me) p.o = 1; }
          else L.p = L.p.filter(p => p.id !== me);
          pub('lobby', L, true, 'now');
        }
      }
      if (!quietBye) pub('bye/' + me, { f: me, sn: SN, cn: C.cn }, false, 'now');
    }
    endRoom();
  }

  function onOpen() {
    C.att = 0; C.order = orderFrom(C.bi); C.openAt = now();
    qReset();
    C.persistent = R.phase === 'in'; if (R.phase === 'in') C.per = 6;   // odadayken aynı aracıda ısrar et (oda bölünmesin)
    setConn('open');
    log('bağlandı', BROKERS[C.bi].n);
    if (!R.base) return;
    C.mq.subscribe(R.base + '#');
    R.sawRetained = false;
    sendPing();
    if (R.phase === 'creating') {
      const me = myPid(), pr = myProfile();
      R.phase = 'in'; R.role = 'host'; R.everIn = true; R.hostPid = me; C.persistent = true; C.per = 6;
      R.lob = { v: VER, h: me, e: 0, st: 'lobby', cfg: isObj(R.cfg0) ? R.cfg0 : {}, p: [{ id: me, n: pr.n, c: pr.c, sk: pr.sk, tr: pr.tr, pl: pr.pl, rd: R.ready ? 1 : 0, w: 0, o: 0, sn: SN }], x: [], ck: '', cl: null, ts: 0 };
      R.settleUntil = 0;
      publishLobby();
      statusChanged(); emitLobby(); rjWrite();
    } else if (R.phase === 'joining') {
      if (!R.joinT0) R.joinT0 = now();
      sendJoin();
    } else if (R.phase === 'in') {
      // yeniden bağlandık: retain lobi gelecek; herkese kısa bir tolerans ver
      graceAll();
      if (R.role === 'host') R.settleUntil = now() + SETTLE_MS;
      else if (!entry(myPid()) || (entry(myPid()) || {}).o) sendJoin(true);
    }
    statusChanged();
    pRoute();
  }
  function graceAll() { const t = now(); for (const k in R.seen) R.seen[k] = Math.max(R.seen[k], t - DROP_MS + 3500); if (R.hostPid) R.seen[R.hostPid] = Math.max(R.seen[R.hostPid] || 0, t - DROP_MS + 3500); }

  function sendPing() {
    R.lastPing = now();
    pub('ping', { f: myPid(), sn: SN, cn: C.cn, t: Math.round(now() * 10) / 10, r: R.rttN ? Math.round(R.rtt) : -1 });
  }
  function sendJoin(re) {
    R.joinLast = now();
    const pr = myProfile();
    // ck = gördüğümüz son kontrol mesajı: ev sahibi lobiye döndürdükten sonra yolda kalmış eski "hazır" bayrağı geri gelmesin
    pub('join', { f: myPid(), sn: SN, v: VER, n: pr.n, c: pr.c, sk: pr.sk, tr: pr.tr, pl: pr.pl, rd: R.ready ? 1 : 0, re: re ? 1 : 0, ck: R.lob ? R.lob.ck : '' });
  }

  /* ---------------- ev sahibi: lobi yayını ---------------- */
  function publishLobby() {
    clearTimeout(R.pubTimer); R.pubTimer = null;
    if (R.role !== 'host' || !R.lob) return;
    if (!connected() || now() < R.settleUntil) { R.needPub = true; return; }
    R.needPub = false; R.lastPub = now();
    R.lob.ts = Date.now(); R.lob.v = VER; R.lob.h = myPid();
    pub('lobby', R.lob, true);
  }
  function lobbyChanged(immediate) {
    if (R.role !== 'host') return;
    emitLobby();
    if (immediate) publishLobby();
    else if (!R.pubTimer) R.pubTimer = setTimeout(guard(publishLobby, 'publishLobby'), 80);
  }

  /* ---------------- gelen mesajlar ---------------- */
  function onMsg(topic, payload, retain) {
    if (topic.charCodeAt(ROOT.length) === 95 && topic.indexOf(ROOT) === 0) { if (P.subMq && P.subMq === C.mq) pMsg(topic, payload, retain); return; }   // '_on/', '_pr/' (varlık)
    if (!R.base || topic.indexOf(R.base) !== 0) return;
    const sub = topic.slice(R.base.length);
    if (payload.length > 48 * 1024) return;
    const txt = fromUtf8(payload);
    if (sub === 'lobby') { onLobby(txt, retain); return; }
    if (!txt) return;
    let m; try { m = JSON.parse(txt); } catch (e) { return; }
    if (!isObj(m)) return;
    if (sub === 'ping') onPing(m);
    else if (sub.indexOf('s/') === 0) onState(sub.slice(2), m);
    else if (sub === 'ev') onEv(m);
    else if (sub === 'ctl') onCtl(m);
    else if (sub === 'join') onJoin(m);
    else if (sub.indexOf('bye/') === 0) onBye(sub.slice(4), m);
  }

  function onLobby(txt, retain) {
    if (retain) R.sawRetained = true;
    const wasSettling = R.role === 'host' && !!R.settleUntil;
    if (wasSettling) R.settleUntil = 0;
    if (!txt) {                                         // retain temizlendi (oda kapandı)
      if (R.role === 'host' && R.phase === 'in') lobbyChanged(true);   // biz hâlâ buradaysak odayı geri yaz
      return;
    }
    let raw; try { raw = JSON.parse(txt); } catch (e) { return; }
    const L = sanitizeLobby(raw); if (!L) return;
    const me = myPid();
    if (!retain) seen(L.h);                                // retain mesaj canlılık kanıtı DEĞİL (ev sahibi ölmüş olabilir)
    if (L.v !== VER) {
      if (R.phase === 'joining' || (R.phase === 'in' && R.role !== 'host')) { failRoom('ver'); }
      return;
    }
    if (R.role === 'host' && R.phase === 'in') {
      if (L.h === me) { if (R.needPub || wasSettling) publishLobby(); return; }  // kendi yankımız / eski retain'imiz
      const mine = R.lob;
      if (L.e > mine.e || (L.e === mine.e && L.h < me)) { yieldHost(L); return; }
      // bizim lobimiz kazanır: retain'i geri yaz (saniyede en fazla bir)
      if (now() - R.lastContest > 1000) { R.lastContest = now(); publishLobby(); }
      return;
    }
    if (R.phase !== 'joining' && R.phase !== 'in') return;
    const cur = R.lob;
    if (cur && (L.e < cur.e || (L.e === cur.e && L.h !== cur.h && L.h > cur.h))) return;   // eski ya da kaybeden ev sahibi
    acceptLobby(L, retain);
  }
  function acceptLobby(L, retain) {
    const me = myPid(), prevHost = R.hostPid, prevLobHost = R.lob && R.lob.h;
    if (R.phase === 'in' && L.h === me) { adoptHost(L, prevHost); return; }     // devir: ev sahibi bize bıraktı
    R.lob = L; R.hostPid = L.h; R.provT = 0; if (!retain) seen(L.h);
    const mine = L.p.find(p => p.id === me);
    if (R.phase === 'joining') {
      if (!mine || mine.sn !== SN) {                  // henüz kabul edilmedik
        // lobide ev sahibi BİZİZ (sayfa yenilendi / uygulama kapanıp açıldı): canlı eski oturum yoksa birazdan geri alırız (joinTick)
        if (L.h === me && !R.reclaim) { R.reclaim = true; R.reclaimT = now(); }
        else if (L.h !== me) R.reclaim = null;
        return;
      }
      R.phase = 'in'; R.role = 'member'; R.everIn = true; C.persistent = true; C.per = 6;
      for (const p of L.p) seen(p.id);
      log('odaya katıldı', R.code, 'ev sahibi', L.h);
      R.reclaim = null; R.rejoin = false;
      statusChanged();
      emitLobby(); rjWrite();
      // yarış sürerken katıldık: haritayı kurabilmek için son başlatma bilgisini "geç" olarak ver
      if (L.ck) markCtl(L.ck);
      if (L.st === 'race' && L.cl && (L.cl.t === 'start' || L.cl.t === 'next')) emit('net:start', Object.assign({}, L.cl.d, { late: true }));
      return;
    }
    if (prevHost && prevHost !== L.h) emit('net:host', { pid: L.h, me: false, prev: prevLobHost || prevHost });
    if (mine && mine.sn && mine.sn !== SN) {        // aynı pid başka oturumla katıldı → bu oturum çekilir
      log('başka oturum tarafından devralındı');
      endRoom();
      error('dup');
      return;
    }
    // kaçırılan kontrol mesajı (ör. yeniden bağlanırken): lobideki son ctl ile telafi
    if (L.ck && L.cl && !ctlWasSeen(L.ck)) { markCtl(L.ck); fireCtl(L.cl.t, L.cl.d); }
    statusChanged();
    emitLobby();
    if (!mine || mine.o) { if (now() - R.joinLast > 600) sendJoin(true); }
  }
  function yieldHost(L) {
    const me = myPid();
    log('ev sahipliği bırakıldı →', L.h);
    R.role = 'member'; R.settleUntil = 0; clearTimeout(R.pubTimer); R.pubTimer = null; R.needPub = false;
    R.lob = L; R.hostPid = L.h; seen(L.h);
    emit('net:host', { pid: L.h, me: false, prev: me });
    statusChanged(); emitLobby();
    const mine = L.p.find(p => p.id === me);
    if (L.ck && L.cl && !ctlWasSeen(L.ck)) { markCtl(L.ck); fireCtl(L.cl.t, L.cl.d); }
    if (!mine || mine.o || mine.sn !== SN) sendJoin(true);
  }
  function adoptHost(L, prev) {
    const me = myPid();
    log('ev sahipliği devralındı, dönem', L.e);
    const mine = L.p.find(p => p.id === me);
    if (mine) { mine.o = 0; mine.sn = SN; }
    R.role = 'host'; R.lob = L; R.hostPid = me; R.provT = 0; R.kSeq = 0; R.settleUntil = 0;
    statusChanged();
    emit('net:host', { pid: me, me: true, prev: prev && prev !== me ? prev : null });
    lobbyChanged(true);
  }

  function onPing(m) {
    const f = tok(m.f, null); if (!f) return;
    const me = myPid();
    if (f === me) { if (m.sn === SN && m.cn === C.cn && typeof m.t === 'number') rttSample(now() - m.t); else if (m.sn !== SN) R.otherMe = now(); return; }
    const ent = entry(f);
    if (ent && ent.sn && m.sn && ent.sn !== m.sn && R.role !== 'host') return;   // eski oturumun pingi
    seen(f);
    metaFrom(f, m);
    if (R.phase === 'joining') R.pingSeen = true;
  }

  function rttSample(s) { if (s >= 0 && s < 30000) { R.rtt = R.rttN ? R.rtt + (s - R.rtt) * 0.3 : s; R.rttN++; } }
  function metaFrom(id, m) {   // ping alanları (durum mesajına da eklenir): bağlantı/oturum kimliği + kendi ölçtüğü rtt
    const inf = R.info[id] || (R.info[id] = {});
    if (typeof m.r === 'number' && m.r >= 0 && m.r < 60000) inf.rtt = m.r;
    inf.cn = tok(m.cn, inf.cn); inf.sn = tok(m.sn, inf.sn);
  }
  function onJoin(m) {
    if (R.role !== 'host' || R.phase !== 'in' || !R.lob) return;
    const f = tok(m.f, null), me = myPid(), jsn = tok(m.sn, ''); if (!f) return;
    if (f === me) { if (jsn && jsn !== SN) hostCtlRaw('rej', { to: f, sn: jsn, why: 'dup' }); return; }   // ev sahibinin kimliğiyle ikinci sekme
    const L = R.lob;
    if (m.v !== VER) { hostCtlRaw('rej', { to: f, sn: jsn, why: 'ver' }); return; }
    if (L.x.indexOf(f) >= 0) { hostCtlRaw('rej', { to: f, sn: jsn, why: 'kicked' }); return; }
    seen(f);
    const inf = R.info[f] || (R.info[f] = {}); inf.sn = tok(m.sn, inf.sn);
    const e = sanitizeEntry({ id: f, n: m.n, c: m.c, sk: m.sk, tr: m.tr, pl: m.pl, rd: m.rd, sn: m.sn });
    if (!e) return;
    // maç sonu lobiye dönüşü (ctl 'lobby') henüz görmemiş üyenin hazır bayrağı eskidir: sıfır say (geri sayım bayat bayrakla başlamasın)
    if (L.st === 'lobby' && L.cl && L.cl.t === 'lobby' && typeof m.ck === 'string' && m.ck !== L.ck) e.rd = 0;
    const ex = L.p.find(p => p.id === f);
    if (ex) {
      const keepW = ex.w;
      Object.assign(ex, e); ex.w = keepW; ex.o = 0;
    } else {
      if (L.p.filter(p => !p.o).length >= MAXP) {
        const dead = L.p.findIndex(p => p.o && p.id !== me);        // yer açmak için düşmüş birini çıkar
        if (dead >= 0) L.p.splice(dead, 1);
        else { hostCtlRaw('rej', { to: f, sn: jsn, why: 'full' }); return; }
      }
      e.w = L.st === 'lobby' ? 0 : 1; e.o = 0;
      L.p.push(e);
      log('katıldı', f, e.n);
    }
    lobbyChanged(false);
  }

  function ctlWasSeen(k) { return R.ctlSeen.indexOf(k) >= 0; }
  function markCtl(k) { if (!ctlWasSeen(k)) { R.ctlSeen.push(k); if (R.ctlSeen.length > 60) R.ctlSeen.shift(); } }
  const CTL_EVT = { start: 'net:start', next: 'net:next', end: 'net:end', lobby: 'net:toLobby' };
  function fireCtl(t, d) {
    const ev = CTL_EVT[t]; if (!ev) return;
    if (t === 'lobby') R.ready = false;
    emit(ev, Object.assign({}, isObj(d) ? d : {}));
  }
  function onCtl(m) {
    const t = str(m.t, 16, null), h = tok(m.h, null); if (!t || !h) return;
    const d = isObj(m.d) ? m.d : {}, me = myPid();
    seen(h);
    if (t === 'rej') {
      if (d.to !== me || !R.phase || (d.sn && d.sn !== SN)) return;     // başka oturuma (aynı pid) yönelik olabilir
      if (d.why === 'kicked' && R.phase === 'in') { rjClear(R.code); endRoom(); emit('net:kicked', { by: h, msg: ERR.kicked }); return; }
      failRoom(ERR[d.why] && d.why !== 'conn' && d.why !== 'nows' && d.why !== 'badcode' ? d.why : 'noroom');
      return;
    }
    const key = h + ':' + str(m.k, 40, '');
    if (R.role === 'host' && h === me) {                // kendi kontrol mesajımızın yankısı → yerelde şimdi uygula
      const pl = R.pendLocal[key];
      if (pl) { clearTimeout(pl.timer); delete R.pendLocal[key]; if (!ctlWasSeen(key)) { markCtl(key); fireCtl(pl.t, pl.d); } }
      return;
    }
    if (R.phase !== 'in' || !R.lob) return;
    if (!(h === R.lob.h || h === R.hostPid || (typeof m.e === 'number' && m.e > R.lob.e))) return;
    if (t === 'kick') {
      if (d.to === me) {
        log('atıldı');
        rjClear(R.code); endRoom();
        emit('net:kicked', { by: h, msg: ERR.kicked });
      }
      return;
    }
    if (ctlWasSeen(key)) return;
    markCtl(key);
    fireCtl(t, d);
  }

  function onEv(m) {
    const f = tok(m.f, null); if (!f || f === myPid()) return;
    const type = tok(m.e, null); if (!type) return;
    seen(f);
    const lat = latencyFrom(f, m.t);
    if (type === 'emoji') {
      const e = cleanEmoji(m.d && m.d.e); if (!e) return;
      emit('net:emoji', { from: f, e, me: false, lat });
      return;
    }
    emit('net:event', { from: f, type, data: isObj(m.d) ? m.d : {}, lat });
  }
  function latencyFrom(f, st) {
    const inf = R.info[f], o = offs[f];
    const base = ((inf && typeof inf.rtt === 'number') ? inf.rtt : (R.rtt || 100)) / 2 + (R.rtt || 100) / 2;
    let extra = 0; if (o && typeof st === 'number') extra = Math.max(0, now() - (st + o.off));
    return Math.round(base + extra);
  }

  function onBye(id, m) {
    if (!tok(id, null) || id === myPid()) return;
    const ent = entry(id), inf = R.info[id] || {};
    const sn = tok(m.sn, ''), cn = tok(m.cn, '');
    if (sn && ent && ent.sn && sn !== ent.sn) return;                 // eski oturumun vedası
    if (m.w && cn && inf.cn && cn !== inf.cn) return;                 // eski bağlantının Last Will'i (çoktan yeniden bağlandı)
    log('ayrıldı', id, m.w ? '(will)' : '');
    if (m.w) {
      // Last Will: bağlantısı koptu ama birkaç sn içinde yeniden bağlanabilir (ağ değişimi) → hemen düşürme, 5 sn tolerans
      R.seen[id] = Math.min(typeof R.seen[id] === 'number' ? R.seen[id] : 0, now() - DROP_MS + 5000);
      emitPlayers(true);
      return;
    }
    R.seen[id] = -1e9;
    if (R.phase !== 'in') return;
    if (R.role === 'host') hostTick(now());
    else if (id === R.hostPid) memberTick(now());
    emitPlayers(true);
  }

  /* ---------------- durum anlık görüntüleri ---------------- */
  function onState(id, m) {
    const me = myPid();
    if (!tok(id, null) || typeof m.t !== 'number') return;
    if (id === me) { if (m.sn === SN && m.cn === C.cn && typeof m.p === 'number') rttSample(now() - m.p); return; }
    seen(id);
    if (typeof m.cn === 'string') metaFrom(id, m);
    if (R.phase === 'joining') R.pingSeen = true;
    const t = now();
    let o = offs[id];
    const sample = t - m.t;
    if (!o) o = offs[id] = { off: sample, jit: 0, iv: STATE_MS, dly: 130, lastSt: m.t, n: 0 };
    else {
      if (sample < o.off || sample - o.off > 1500) o.off = sample; else o.off += (sample - o.off) * 0.01;
      // tepe izleyen (hızlı yükselen, yavaş inen) tahminler: tampon boşalıp öngörüye düşmeyelim
      const ex = Math.max(0, sample - o.off); o.jit += (ex - o.jit) * (ex > o.jit ? 0.25 : 0.03);
      const dst = m.t - o.lastSt;
      if (dst > 0 && dst < 1000) { const g = Math.min(500, Math.max(30, dst)); o.iv += (g - o.iv) * (g > o.iv ? 0.25 : 0.03); }
      o.lastSt = m.t;
      const target = Math.min(450, Math.max(80, o.iv + o.jit + 10));
      o.dly += (target - o.dly) * (o.n < 12 ? 0.3 : 0.05); o.n++;   // ilk mesajlarda hızlı otur, sonra yumuşak izle
    }
    const lt = m.t + o.off;
    if (isObj(m.s)) pushBuf(id, id, lt, m.s, t);
    if (isObj(m.b)) { let n = 0; for (const bid in m.b) { if (++n > 12) break; if (tok(bid, null) && bid !== me && isObj(m.b[bid])) pushBuf(bid, id, lt, m.b[bid], t); } }
  }
  function pushBuf(id, src, lt, d, t) {
    let b = bufs[id];
    if (!b) b = bufs[id] = { src, arr: [], last: 0 };
    if (b.src !== src) { b.src = src; b.arr.length = 0; }           // gönderen değişti (ev sahibi göçü): zaman çizelgesi yeni
    const a = b.arr;
    if (a.length && lt <= a[a.length - 1].t) return;                // sıra dışı / tekrar
    a.push({ t: lt, d });
    b.last = t;
    const cut = lt - BUF_MS; let k = 0; while (a.length - k > 2 && a[k].t < cut) k++;
    if (k) a.splice(0, k);
  }
  const LERP = ['x', 'y', 'vx', 'vy'];
  function sample(id, delay) {
    const b = bufs[id]; if (!b || !b.arr.length) return null;
    const o = offs[b.src], t = now();
    const D = (typeof delay === 'number' && isFinite(delay)) ? delay : (o ? o.dly : 130);
    const rt = t - D, a = b.arr;
    let i = a.length - 1; while (i >= 0 && a[i].t > rt) i--;
    let out;
    if (i < 0) out = Object.assign({}, a[0].d);
    else if (i === a.length - 1) {
      const e = a[i]; out = Object.assign({}, e.d);
      const dt = Math.min(rt - e.t, EXTRA_MS) / 1000;
      if (dt > 0 && !e.d.dd) {
        if (typeof e.d.x === 'number' && typeof e.d.vx === 'number') out.x = e.d.x + e.d.vx * dt;
        if (typeof e.d.y === 'number' && typeof e.d.vy === 'number') out.y = e.d.y + e.d.vy * dt;
        out._ex = 1;
      }
    } else {
      const A = a[i], B = a[i + 1], k = (rt - A.t) / Math.max(1, B.t - A.t);
      out = Object.assign({}, A.d);
      const jump = A.d.j !== B.d.j || (typeof A.d.x === 'number' && typeof B.d.x === 'number' && Math.abs(B.d.x - A.d.x) > 400) || (typeof A.d.y === 'number' && typeof B.d.y === 'number' && Math.abs(B.d.y - A.d.y) > 400);
      if (!jump) for (const key of LERP) { const va = A.d[key], vb = B.d[key]; if (typeof va === 'number' && typeof vb === 'number') out[key] = va + (vb - va) * k; }
    }
    out._age = Math.round(t - b.last);
    out._stale = out._age > 1500 ? 1 : 0;
    return out;
  }
  function pruneBufs(t) { for (const k in bufs) if (t - bufs[k].last > 60000) delete bufs[k]; }
  const flushState = guard(function () {
    R.stTimer = null;
    const p = R.pend; if (!p) return;
    if (!connected()) { R.pend = null; return; }
    const t = now();
    const m = { t: Math.round(p.t * 10) / 10, s: p.s }; if (p.b) m.b = p.b;
    const meta = t - R.lastPing >= PING_MS;          // yayın sürerken ayrı ping yerine durum mesajı ping alanlarını taşır
    if (meta) { m.sn = SN; m.cn = C.cn; m.p = Math.round(t * 10) / 10; m.r = R.rttN ? Math.round(R.rtt) : -1; }
    if (!pub('s/' + myPid(), m, false, 'st')) { R.stTimer = setTimeout(flushState, 40); return; }   // bütçe yok: az sonra en güncelini dene
    R.pend = null; R.lastState = t; if (meta) R.lastPing = t;
  }, 'flushState');

  /* ---------------- zamanlayıcı: ping, canlılık, göç, katılma ---------------- */
  const tick = guard(function () {
    const t = now(), gap = t - R.lastTick; R.lastTick = t;
    if (gap > 3000 && R.phase) onResume('tik boşluğu ' + Math.round(gap));
    if (C.mq) C.mq.tick(t);
    if (!R.phase) return;
    if (!connected()) return;
    if ((R.phase === 'in' || R.phase === 'joining') && C.mq && t - C.mq.lastRx > SILENT_MS && t - C.openAt > SILENT_MS) { reconnectNow('sessiz bağlantı'); return; }
    if (t - R.lastPing >= PING_MS) sendPing();
    if (R.phase === 'joining') joinTick(t);
    else if (R.phase === 'in') { if (R.role === 'host') hostTick(t); else memberTick(t); }
    if (R.phase === 'in' && t - R.rjT > RJ_LIVE_MS && !(typeof document !== 'undefined' && document && document.hidden)) rjWrite();
    pruneBufs(t);
    emitPlayers(false);
  }, 'tick');
  function joinTick(t) {
    if (t - R.joinLast >= JOIN_RESEND) sendJoin();
    // eski ev sahibi oturumumuz yanıt vermiyor (yenileme / uygulama kapandı) → odayı geri al. Yarış sürerken başkaları canlıysa
    // geri ALMA: onlar birazdan aralarından yeni ev sahibi seçer (botları o devralır), biz üye olarak aynı yarışçıya döneriz.
    if (R.reclaim && t - R.reclaimT > RECLAIM_MS && t - (R.otherMe || -1e9) > DROP_MS && (R.reclaim.st === 'lobby' || !R.pingSeen)) { reclaimHost(); return; }
    // hiç ping yok + retain lobi yok → oda yok (canlı odada ev sahibi 2 sn'de bir pingler); retain var ama yanıt yok → biraz daha bekle
    const lim = R.pingSeen ? JOIN_TIMEOUT_ALIVE : (R.sawRetained ? JOIN_TIMEOUT : JOIN_TIMEOUT_EMPTY);
    if (R.joinT0 && t - R.joinT0 > lim) {
      // kodun aracısı denemelerde yanıt vermeyip yedeğe düştüysek oda orada olamaz: bir tur daha kodun aracısını dene
      if (C.bi !== R.codeBi && !R.joinRetry) {
        log('yedek aracıda oda yok → kodun aracısına dönülüyor');
        R.joinRetry = 1; R.joinT0 = 0; R.pingSeen = false; R.sawRetained = false;
        startConnect(R.codeBi, 3, false);
        return;
      }
      if (!R.pingSeen && R.sawRetained) pub('lobby', '', true, 'now');   // kimse yok: bayat retain lobiyi temizle
      failRoom('noroom');
    }
  }
  function hostTick(t) {
    if (R.settleUntil && t < R.settleUntil) return;
    if (R.settleUntil) { R.settleUntil = 0; R.needPub = true; }        // retain gelmedi: lobimizi yeniden yaz
    if (R.needPub) publishLobby();
    const L = R.lob; if (!L) return;
    const me = myPid(); let ch = false;
    for (let i = L.p.length - 1; i >= 0; i--) {
      const p = L.p[i]; if (p.id === me) continue;
      const al = alive(p.id);
      if (!al && !p.o) { if (L.st === 'lobby') L.p.splice(i, 1); else p.o = 1; ch = true; log('düştü', p.id); }
      else if (al && p.o) { p.o = 0; ch = true; }
    }
    if (ch) lobbyChanged(false);
  }
  function memberTick(t) {
    const L = R.lob; if (!L) return;
    if (R.hostPid && R.hostPid !== L.h && R.provT && t - R.provT > 8000) { R.hostPid = L.h; R.provT = 0; }  // geçici seçim tutmadı
    if (R.hostPid && !alive(R.hostPid)) migrate();
    if (R.phase !== 'in' || R.role !== 'member') return;
    const mine = entry(myPid());
    if ((!mine || mine.o) && t - R.joinLast >= JOIN_RESEND) sendJoin(true);
  }
  function migrate() {
    const L = R.lob, me = myPid(), old = R.hostPid;
    const cands = [me];
    for (const p of L.p) if (p.id !== old && p.id !== me && !p.o && alive(p.id)) cands.push(p.id);
    cands.sort();
    const nh = cands[0];
    log('ev sahibi düştü', old, '→ aday', nh);
    if (nh === me) becomeHost(old);
    else if (nh !== R.hostPid) { R.hostPid = nh; R.provT = now(); emit('net:host', { pid: nh, me: false, prev: old, pending: true }); statusChanged(); emitPlayers(true); }
  }
  function becomeHost(old) {
    const me = myPid(), L = clone(R.lob); if (!L) return;
    L.h = me; L.e = (L.e | 0) + 1;
    if (L.st === 'lobby') L.p = L.p.filter(p => p.id !== old); else for (const p of L.p) if (p.id === old) p.o = 1;
    const mine = L.p.find(p => p.id === me);
    if (mine) { mine.o = 0; mine.sn = SN; } else { const pr = myProfile(); L.p.push({ id: me, n: pr.n, c: pr.c, sk: pr.sk, tr: pr.tr, pl: pr.pl, rd: R.ready ? 1 : 0, w: 0, o: 0, sn: SN }); }
    R.role = 'host'; R.lob = L; R.hostPid = me; R.provT = 0; R.kSeq = 0; R.settleUntil = 0;
    log('ev sahibi oldum, dönem', L.e);
    publishLobby();
    statusChanged();
    emit('net:host', { pid: me, me: true, prev: old });
    emitLobby();
  }
  function reclaimHost() {
    R.reclaim = null;
    const L = R.lob ? clone(R.lob) : null;
    if (!L || R.phase !== 'joining' || L.v !== VER || L.h !== myPid()) return;
    const me = myPid(), alone = !R.pingSeen, pr = myProfile();
    if (alone) {                                         // kimse yok: oda lobiye döner (yarım kalan yarış yok sayılır)
      L.p = L.p.filter(p => p.id === me);
      if (L.st !== 'lobby') { L.st = 'lobby'; L.cl = null; L.ck = ''; }
    }
    let mine = L.p.find(p => p.id === me);
    if (!mine) { mine = { id: me }; L.p.unshift(mine); }
    Object.assign(mine, { n: pr.n, c: pr.c, sk: pr.sk, tr: pr.tr, pl: pr.pl, rd: R.ready ? 1 : 0, w: 0, o: 0, sn: SN });
    L.h = me; L.e = (L.e | 0) + 1;
    log('ev sahipliği geri alındı', R.code, alone ? '(yalnız)' : '(lobide ' + L.p.length + ' kişi)');
    R.lob = L; R.phase = 'in'; R.role = 'host'; R.everIn = true; R.hostPid = me; R.provT = 0; R.kSeq = 0; R.settleUntil = 0; R.rejoin = false;
    C.persistent = true; C.per = 6;
    for (const p of L.p) if (p.id !== me) seen(p.id);
    if (L.ck) markCtl(L.ck);
    publishLobby();
    statusChanged(); emitLobby(); rjWrite();
  }
  function onResume(why) {
    log('askıdan dönüş:', why);
    graceAll();
    if (!R.phase) return;
    if (!C.want) return;
    if (!connected()) { if (!C.mq) reconnectNow('dönüş'); return; }
    C.mq.probe();
    if (R.base) C.mq.subscribe(R.base + '#');       // aynı filtreye yeniden abone olmak retain lobiyi tekrar getirir
    if (R.role === 'host') R.settleUntil = now() + SETTLE_MS;
    sendPing();
  }

  /* ---------------- ev sahibi kontrol mesajları ---------------- */
  function hostCtlRaw(t, d) {
    R.kSeq++;
    const k = (R.lob ? R.lob.e : 0) + '.' + R.kSeq;
    return pub('ctl', { t, h: myPid(), e: R.lob ? R.lob.e : 0, k, d: d || {} }) ? k : null;
  }
  function hostCtl(t, d) {
    if (R.role !== 'host' || R.phase !== 'in' || !R.lob || !connected()) return false;
    d = isObj(d) ? d : {};
    const k = hostCtlRaw(t, d); if (!k) return false;
    const key = myPid() + ':' + k, L = R.lob;
    if (t === 'start' || t === 'next') { L.st = 'race'; for (const p of L.p) if (!p.o) p.w = 0; }
    else if (t === 'end') L.st = 'results';
    else if (t === 'lobby') { L.st = 'lobby'; L.p = L.p.filter(p => !p.o || p.id === myPid()); for (const p of L.p) { p.w = 0; p.rd = 0; } R.ready = false; }
    L.ck = key; L.cl = { t, d };
    lobbyChanged(true);
    // ev sahibi de kendi mesajını aracıdan dönünce uygular (herkesle aynı anda başlasın); yankı gelmezse 1 sn sonra
    const self = { t, d, timer: null };
    self.timer = setTimeout(guard(function () { if (R.pendLocal[key] === self) { delete R.pendLocal[key]; if (!ctlWasSeen(key)) { markCtl(key); fireCtl(t, d); } } }, 'ctlFallback'), 1000);
    R.pendLocal[key] = self;
    return true;
  }

  /* ---------------- emoji ---------------- */
  function cleanEmoji(e) {
    if (typeof e !== 'string') return '';
    const s = Array.from(e.replace(/[\u0000-\u001f<>"'`\\]/g, '')).slice(0, 8).join('');
    return s.trim();
  }

  /* =================== VARLIK: çevrimiçi listesi + profil kartları (TUR5 §8) ===================
     Oyun açıkken (oda dışında da) hafif bir bağlantı. Konular:
       fuatmorel/v1/_on/<pid>  canlı nabız (retain YOK): görünürken 5 sn'de bir + durum değişince; sayfa kapanırken {st:'off'}
       fuatmorel/v1/_pr/<pid>  profil kartı (RETAIN): değişince + görünürken dakikada bir + gizlenince/kapanırken (ls = son görülme ms)
     Çevrimiçi = son ~12 sn içinde nabız geldi (uydurma yok). Sekme 60 sn'den uzun gizliyse durum 'away' (Uzakta), nabız 30 sn'ye
     seyrekleşir; 'away' ASLA çevrimiçi sayılmaz. Oda bağlantısı aynı aracıdaysa onu paylaşır (ikinci soket açmaz).
     Kare başına iş yok (1 sn'lik zamanlayıcı); aracıya ulaşılamazsa sessizce bekler, oyunu asla etkilemez.
     Paylaşılan: takma ad, karakter, durum, oda kodu (yalnız açık lobide) ve profil kartı. Başka kişisel bilgi yok. */
  const PR_ON = ROOT + '_on/', PR_PR = ROOT + '_pr/';
  const HB_MS = 5000, HB_AWAY_MS = 30000, AWAY_AFTER = 60000, ONLINE_MS = 12000, AWAY_TTL = 75000;
  const CARD_MS = 60000, CARD_MIN_MS = 3000, WARM_MS = 7000, CAME_GAP = 600000, BLIP_MS = 20000, PMAX = 300;
  const ST_RANK = { lobby: 0, race: 1, solo: 2, menu: 3, away: 4 };
  const P = {
    on: false, halt: false,                 // açık mı / sayfa kapanıyor (bfcache) — halt iken yeniden bağlanmaz
    mq: null, bi: -1, ord: 0, att: 0, timer: null, cn: '', openAt: 0, conn: 'off', homeT: 0,
    subMq: null,                            // varlık konularına abone olunan bağlantı (kendi ya da paylaşılan oda bağlantısı)
    shareWait: 0, iv: null, lastTick: 0,
    lastHb: -1e9, hbSig: '', lastCard: -1e9, cardSig: '', cardDirty: true, hiddenAt: 0, warmUntil: 0,
    peers: {},                              // pid → canlı kayıt {pid, nick, char, st, code, n, max, open, t, sns: {oturum: bitiş}}
    cards: {},                              // pid → profil kartı (retain)
    ls: {},                                 // pid → yerelde son görülme (canlı nabız anı, ms)
    gone: {}, cameAt: {}, lobAt: {},        // kısa kesinti tespiti / net:came ve net:lobby-open sınırları
    emitT: null, onSig: '', prSig: '', prT: -1e9, prDirty: false, myCardC: null, myCardT: -1e9
  };
  const pUrlOf = bi => (bi >= 0 && bi < BROKERS.length ? BROKERS[bi].url : '');
  const pTarget = () => PREF[P.ord % PREF.length];
  const pShared = () => connected() && C.bi >= 0 && pUrlOf(C.bi) === pUrlOf(pTarget());
  const pOwnOk = () => !!(P.mq && P.mq.ok && !P.mq.done);
  const pMq = () => (pShared() ? C.mq : (pOwnOk() ? P.mq : null));
  const pHiddenLong = () => !!P.hiddenAt && now() - P.hiddenAt > AWAY_AFTER;
  function pStatus() {
    const sh = pShared() && P.subMq === C.mq, bi = sh ? C.bi : P.bi;
    return { on: P.on, conn: P.conn, shared: sh, broker: bi, brokerName: bi >= 0 ? BROKERS[bi].n : '', n: P.on ? onlineCount() : 0 };
  }
  function pSetConn(s) { if (P.conn === s) return; P.conn = s; emit('net:presence', pStatus()); pChanged(); }

  /* ---- bağlantı: paylaş ya da kendi bağlantını aç ---- */
  function pRoute() {
    if (!P.on || P.halt) { pStopOwn(); P.subMq = null; pSetConn('off'); return; }
    if (pShared()) {
      pStopOwn();
      if (P.subMq !== C.mq) { pSubscribe(C.mq); pBeat(true); pCardPub(1); }
      pSetConn('open');
      return;
    }
    if (P.subMq && P.subMq !== P.mq) P.subMq = null;          // paylaşılan oda bağlantısı gitti
    if (pOwnOk()) { if (P.subMq !== P.mq) pSubscribe(P.mq); pSetConn('open'); return; }
    if (P.mq || P.timer) return;                               // bağlanıyor ya da bekliyor
    // oda aynı aracıya yeniden bağlanıyorsa kısa süre bekle (gereksiz ikinci soket açma)
    const w = P.shareWait - now();
    if (C.want && C.bi >= 0 && pUrlOf(C.bi) === pUrlOf(pTarget()) && w > 0) { P.timer = setTimeout(pRouteT, w + 50); return; }
    pAttempt();
  }
  const pRouteT = guard(function () { P.timer = null; pRoute(); }, 'pRouteT');
  const pAttempt = guard(function () {
    P.timer = null;
    if (!P.on || P.halt || pShared() || P.mq) return;
    if (typeof WebSocket === 'undefined') { pSetConn('off'); return; }
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {   // çevrimdışı: 'online' olayı ya da 30 sn sonra tekrar
      pSetConn('offline'); P.timer = setTimeout(pAttempt, 30000); return;
    }
    const bi = pTarget(); P.bi = bi; P.cn = rnd(5);
    if (P.conn !== 'open') pSetConn('connecting');
    log('varlık bağlanıyor', BROKERS[bi].n);
    const m = new Mq(BROKERS[bi].url, { cid: 'fm' + myPid() + 'v' + P.cn, keep: KEEP, will: null,
      onOpen: () => { if (P.mq === m) pOnOpen(); }, onClose: (r, w) => { if (P.mq === m) pOnClose(r, w); }, onMsg: (t, p, r) => { if (P.mq === m) pMsg(t, p, r); } });
    P.mq = m; m.open();
  }, 'pAttempt');
  function pOnOpen() {
    if (pShared() || !P.on || P.halt) { pRoute(); return; }
    P.att = 0; P.openAt = now();
    P.homeT = P.ord % PREF.length ? now() + 600000 : 0;      // yedek aracıdaysak 10 dk sonra tercih edilene dönmeyi dene
    log('varlık bağlandı', BROKERS[P.bi].n);
    pSubscribe(P.mq); pSetConn('open'); pBeat(true); pCardPub(1);
  }
  function pOnClose(reason, was) {
    const m = P.mq; P.mq = null; if (P.subMq === m) P.subMq = null;
    log('varlık bağlantısı kapandı:', reason);
    if (!P.on || P.halt) { pSetConn('off'); return; }
    if (pShared()) { pRoute(); return; }
    const short = was && now() - P.openAt < 5000;
    if (!was || short) { P.att++; if (P.att % 2 === 0) P.ord++; }   // aynı aracı iki kez açılmadı → sıradaki (herkes aynı sırayı izler)
    else P.ord = 0;                                                // kurulu bağlantı koptu: önce tercih edilen aracı
    pSetConn('connecting');
    const d = BACKOFF[Math.min(P.att, BACKOFF.length - 1)] * (0.85 + Math.random() * 0.3);
    clearTimeout(P.timer); P.timer = setTimeout(pAttempt, (was && !short) ? 500 : d);
  }
  function pStopOwn() {
    clearTimeout(P.timer); P.timer = null;
    const m = P.mq; P.mq = null;
    if (m) { if (P.subMq === m) P.subMq = null; m.disconnect(); }
  }
  function pSubscribe(mq) {
    mq.subscribe(PR_ON + '+'); mq.subscribe(PR_PR + '+');
    P.subMq = mq; P.warmUntil = Math.max(P.warmUntil, now() + WARM_MS);   // ilk liste: zaten çevrimiçi olanlar için bildirim yok
  }
  // oda bağlantısı kapandı (paylaşıyorsak): oda aynı aracıya dönecekse 4 sn bekle, yoksa kendi bağlantımızı aç
  function pRoomClosed() { try { if (P.subMq && P.subMq.done) P.subMq = null; P.shareWait = now() + 4000; pRoute(); } catch (e) { log('HATA pRoomClosed ' + (e && e.stack || e)); } }
  // yayın: paylaşılan bağlantıda oda bütçesine uyar (oda trafiği öncelikli; yer yoksa tik birazdan tekrar dener)
  function pSend(sub, obj, retain, urgent) {
    const mq = pMq(); if (!mq) return false;
    const payload = JSON.stringify(obj);
    if (mq === C.mq) {
      const b = bk();
      if (!urgent && (Q.q.length || used(now()) + 1 + b.res > b.win)) return false;
      return send(ROOT + sub, payload, !!retain, false);
    }
    return mq.publish(ROOT + sub, payload, !!retain, false);
  }

  /* ---- kendi durumum ve kartım ---- */
  function pState() {
    if (pHiddenLong()) return { st: 'away' };
    if (R.phase === 'in' && R.lob) {
      const n = R.lob.p.filter(p => !p.o).length, lob = R.lob.st === 'lobby', open = lob && n < MAXP && !!R.code;
      const o = { st: lob ? 'lobby' : 'race', n, max: MAXP, open };
      if (open) o.code = R.code;
      return o;
    }
    const S = FM.S;
    const solo = !!S && !S.netRole && (S.mode === 'count' || S.mode === 'race' || S.mode === 'end' || S.mode === 'podium');
    return { st: solo ? 'solo' : 'menu' };
  }
  function pBeatSig() { const s = pState(), pr = myProfile(); return [pr.n, pr.c, s.st, s.code || '', s.n == null ? '' : s.n, s.open ? 1 : 0].join('|'); }
  function pBeat(force) {
    if (!P.on || P.halt) return false;
    const t = now(); if (!force && t - P.lastHb < 900) return false;
    const s = pState(), pr = myProfile(), me = myPid();
    const m = Object.assign({ pid: me, nick: pr.n, char: pr.c, sn: SN, iv: Math.round((s.st === 'away' ? HB_AWAY_MS : HB_MS) / 1000), v: VER }, s);
    if (!pSend('_on/' + me, m, false, false)) return false;
    P.lastHb = t; P.hbSig = pBeatSig();
    return true;
  }
  function sanitizeCard(c, pid) {
    if (!isObj(c) || !tok(pid, null)) return null;
    const I = (v, max) => fin(v) && v >= 0 ? Math.min(max, Math.floor(v)) : 0;
    const okc = isChar;
    return {
      pid, nick: cleanNick(c.nick) || 'Oyuncu', char: okc(c.char) ? c.char : 'TAFTAF', skin: tok(c.skin, 'klasik'),
      lvl: fin(c.lvl) ? Math.max(1, Math.min(999, Math.floor(c.lvl))) : 1, tr: I(c.tr, 1e7), play: I(c.play, 1e9),
      races: I(c.races, 1e8), wins: I(c.wins, 1e8), kills: I(c.kills, 1e8), best: okc(c.best) ? c.best : null,
      since: fin(c.since) && c.since > 1.4e12 && c.since < Date.now() + 864e5 ? Math.floor(c.since) : 0,
      lg: tok(c.lg, null), ls: fin(c.ls) && c.ls > 0 ? Math.min(Math.floor(c.ls), Date.now()) : 0
    };
  }
  // profil kartı: FM.meta.card() (PROFİL); yoksa kayıttan yedek
  function myCard() {
    const t = now(); if (P.myCardC && t - P.myCardT < 1500) return P.myCardC;
    let c = null;
    try { if (FM.meta && typeof FM.meta.card === 'function') c = FM.meta.card(); } catch (e) { c = null; }
    if (!isObj(c)) {
      const sv = FM.save || {}, st = isObj(sv.stats) ? sv.stats : {}, pr = myProfile();
      let tr = 0; if (isObj(sv.trophies)) for (const k in sv.trophies) if (fin(sv.trophies[k]) && sv.trophies[k] > 0) tr += sv.trophies[k];
      c = { nick: myNick(), char: pr.c, skin: pr.sk, lvl: sv.level, tr, play: st.playSec, races: st.races, wins: st.wins, kills: st.kills, best: null, since: sv.since || sv.created };
    }
    const pr = myProfile();
    c = sanitizeCard(Object.assign({}, c, { nick: cleanNick(c && c.nick) || pr.n }), myPid());
    P.myCardC = c; P.myCardT = t;
    return c;
  }
  // mode: 0 = değiştiyse (≥3 sn arayla) ya da dakikası geldiyse, 1 = şimdi (≥1.5 sn arayla), 2 = hemen (sayfa kapanıyor)
  function pCardPub(mode) {
    if (!P.on || P.halt) return false;
    const t = now();
    if (mode === 1 && t - P.lastCard < 1500) return false;
    P.myCardT = -1e9;
    const c = myCard(); if (!c) return false;
    const sig = [c.nick, c.char, c.skin, c.lvl, c.tr, Math.floor(c.play / 60), c.races, c.wins, c.kills, c.best, c.since, c.lg].join('|');
    if (!mode) { if (sig === P.cardSig && t - P.lastCard < CARD_MS) { P.cardDirty = false; return false; } if (t - P.lastCard < CARD_MIN_MS) return false; }
    const out = Object.assign({}, c, { ls: Date.now(), v: VER });
    if (!pSend('_pr/' + c.pid, out, true, mode === 2)) return false;
    P.lastCard = t; P.cardSig = sig; P.cardDirty = false;
    return true;
  }

  /* ---- gelenler ---- */
  function pMsg(topic, payload, retain) {
    if (payload.length > 4096) return;
    if (topic.indexOf(PR_ON) === 0) pOnBeat(topic.slice(PR_ON.length), payload);
    else if (topic.indexOf(PR_PR) === 0) pOnCard(topic.slice(PR_PR.length), payload, retain);
  }
  function pOnBeat(pid, payload) {
    if (!tok(pid, null) || pid === myPid() || !payload.length) return;
    let m; try { m = JSON.parse(fromUtf8(payload)); } catch (e) { return; }
    if (!isObj(m) || m.pid !== pid) return;
    const t = now(), sn = tok(m.sn, '-');
    let e = P.peers[pid];
    if (m.st === 'off') {                                   // sayfa kapandı: o oturum hemen düşer
      if (e) {
        if (e.st !== 'away') P.ls[pid] = Date.now();
        delete e.sns[sn];
        if (!m.sn || !Object.keys(e.sns).length) pGone(pid);
        pChanged();
      }
      return;
    }
    if (!ST_RANK.hasOwnProperty(m.st)) return;
    if (!e && Object.keys(P.peers).length >= PMAX) return;
    const wasOn = !!e && e.st !== 'away';
    const pc = typeof m.code === 'string' ? parseCode(m.code) : null;
    const code = m.st === 'lobby' && pc ? pc.code : null;
    const card = P.cards[pid];
    const d = {
      pid, nick: cleanNick(m.nick) || (card ? card.nick : '') || 'Oyuncu', char: isChar(m.char) ? m.char : (card ? card.char : 'TAFTAF'),
      st: m.st, code, n: fin(m.n) ? Math.max(0, Math.min(MAXP, m.n | 0)) : null, max: fin(m.max) ? Math.max(1, Math.min(MAXP, m.max | 0)) : null,
      open: !!(m.open && code)
    };
    if (!e) e = P.peers[pid] = { sns: {} };
    const prevCode = e.code || null;
    Object.assign(e, d); e.t = t;
    e.sns[sn] = t + (m.st === 'away' ? AWAY_TTL : ONLINE_MS);
    let k = 0; for (const s in e.sns) if (++k > 4) delete e.sns[s];      // aynı kimlikle en fazla birkaç sekme
    if (!wasOn && m.st !== 'away') pCame(e);
    if (m.st !== 'away') { P.ls[pid] = Date.now(); delete P.gone[pid]; }
    if (!wasOn) pReply();
    if (code && code !== prevCode) pLobbyOpen(e);
    pChanged();
  }
  function pOnCard(pid, payload, retain) {
    if (!tok(pid, null) || pid === myPid()) return;
    if (!payload.length) { if (P.cards[pid]) { delete P.cards[pid]; pChanged(); } return; }   // retain silindi
    let m; try { m = JSON.parse(fromUtf8(payload)); } catch (e) { return; }
    if (!isObj(m) || (m.pid != null && m.pid !== pid)) return;
    const c = sanitizeCard(m, pid); if (!c) return;
    if (!P.cards[pid]) {
      const ks = Object.keys(P.cards);
      if (ks.length >= PMAX) {                               // dolu: en eski son görülmeyi at (yeni kart daha eskiyse alma)
        let old = null; for (const q of ks) if (!old || P.cards[q].ls < P.cards[old].ls) old = q;
        if (!old || P.cards[old].ls >= c.ls) return;
        delete P.cards[old];
      }
    }
    P.cards[pid] = c;
    if (!retain && P.peers[pid] && P.peers[pid].st !== 'away') P.ls[pid] = Date.now();
    pChanged();
  }
  // yeni biri belirdi: kendi nabzımızı kısa bir rastgele beklemeyle hemen yolla (yeni açan listeyi 5 sn beklemesin; en sık 1 sn'de bir)
  function pReply() {
    if (P.replyT || now() - (P.replyAt || -1e9) < 1000 || typeof setTimeout !== 'function') return;
    P.replyT = setTimeout(guard(function () { P.replyT = null; P.replyAt = now(); pBeat(true); }, 'pReply'), 150 + Math.random() * 600);
  }
  // durum değişti (oda, lobi, yarış): nabzı ~250 ms içinde yolla (1 sn'lik tik de yakalar; en sık 0.9 sn'de bir)
  function pSoon() {
    if (!P.on || P.halt || P.soonT || typeof setTimeout !== 'function') return;
    P.soonT = setTimeout(guard(function () { P.soonT = null; if (pMq() && pBeatSig() !== P.hbSig) pBeat(); }, 'pSoon'), 250);
  }
  function pGone(pid) { delete P.peers[pid]; P.gone[pid] = now(); }
  function pView(e, t) {
    const c = P.cards[e.pid];
    return { pid: e.pid, nick: e.nick, char: e.char, skin: c ? c.skin : 'klasik', st: e.st, code: e.code || null, n: e.n, max: e.max, open: !!e.open, me: false, age: Math.round((t || now()) - e.t) };
  }
  function pCame(e) {
    const t = now(), pid = e.pid;
    if (t < P.warmUntil) { P.cameAt[pid] = t; if (e.code) P.lobAt[e.code] = t; return; }   // ilk liste: zaten çevrimiçiydi
    if (P.gone[pid] && t - P.gone[pid] < BLIP_MS) return;                                   // kısa kesinti (sayfa yenileme, ağ değişimi)
    if (P.cameAt[pid] && t - P.cameAt[pid] < CAME_GAP) return;                              // aynı kişi için 10 dk'da en fazla bir kez
    P.cameAt[pid] = t; if (e.code) P.lobAt[e.code] = t;
    emit('net:came', { p: pView(e, t) });
  }
  function pLobbyOpen(e) {
    const t = now(), c = e.code;
    if (!c || c === R.code) return;                          // kendi odam değil
    if (P.lobAt[c] && t - P.lobAt[c] < CAME_GAP) return;
    P.lobAt[c] = t;
    if (t < P.warmUntil) return;
    emit('net:lobby-open', { p: pView(e, t) });
  }

  /* ---- listeler ve olaylar ---- */
  function onlineCount() { let n = 0; for (const k in P.peers) if (P.peers[k].st !== 'away') n++; return n; }
  function onlineList() {
    if (!P.on || P.conn !== 'open') return [];
    const t = now(), s = pState(), pr = myProfile(), out = [];
    out.push({ pid: myPid(), nick: pr.n, char: pr.c, skin: pr.sk, st: s.st, code: s.code || null, n: s.n != null ? s.n : null, max: s.max || null, open: !!s.open, me: true, age: 0 });
    for (const k in P.peers) out.push(pView(P.peers[k], t));
    out.sort((a, b) => (b.me - a.me) || ((b.open ? 1 : 0) - (a.open ? 1 : 0)) || (ST_RANK[a.st] - ST_RANK[b.st]) || String(a.nick).localeCompare(String(b.nick), 'tr'));
    return out;
  }
  function profilesList() {
    const out = [], ids = {};
    for (const k in P.cards) ids[k] = 1;
    for (const k in P.peers) ids[k] = 1;
    const mine = myCard(), ps = pState(), meOn = P.on && P.conn === 'open';
    if (mine) out.push(Object.assign({}, mine, { ls: Date.now(), online: meOn, st: meOn ? ps.st : 'off', away: ps.st === 'away', code: ps.code || null, me: true }));
    for (const pid in ids) {
      if (pid === myPid()) continue;
      const c = P.cards[pid], e = P.peers[pid], on = !!e && e.st !== 'away';
      out.push({
        pid, nick: e ? e.nick : c.nick, char: e ? e.char : c.char, skin: c ? c.skin : 'klasik',
        lvl: c ? c.lvl : null, tr: c ? c.tr : null, play: c ? c.play : null, races: c ? c.races : null, wins: c ? c.wins : null, kills: c ? c.kills : null,
        best: c ? c.best : null, since: c && c.since ? c.since : null, lg: c ? c.lg : null,
        ls: Math.max(c ? c.ls : 0, P.ls[pid] || 0) || null, online: on, st: e ? e.st : 'off', away: !!e && e.st === 'away', code: e ? e.code : null, me: false
      });
    }
    out.sort((a, b) => (b.me - a.me) || ((b.online ? 1 : 0) - (a.online ? 1 : 0)) || ((b.away ? 1 : 0) - (a.away ? 1 : 0)) || ((b.ls || 0) - (a.ls || 0)));
    return out;
  }
  function pChanged() { if (!P.emitT && typeof setTimeout === 'function') P.emitT = setTimeout(pEmit, 300); }
  const pEmit = guard(function () {
    P.emitT = null;
    const list = onlineList();
    const sig = P.conn + '#' + list.map(x => [x.pid, x.st, x.code || '', x.n == null ? '' : x.n, x.nick, x.char].join(',')).join(';');
    if (sig !== P.onSig) { P.onSig = sig; emit('net:online', { list, n: list.filter(x => !x.me && x.st !== 'away').length }); }
    const t = now();
    const prof = profilesList();
    const psig = prof.map(x => [x.pid, x.online ? 1 : 0, x.st, x.nick, x.char, x.skin, x.lvl, x.tr, Math.floor((x.play || 0) / 60), x.races, x.wins, x.kills, x.online ? 0 : Math.floor((x.ls || 0) / 60000)].join(',')).join(';');
    if (psig === P.prSig) { P.prDirty = false; return; }
    if (t - P.prT < 1000) { P.prDirty = true; return; }        // seyreltme: tik birazdan tekrar dener
    P.prSig = psig; P.prT = t; P.prDirty = false;
    emit('net:profiles', { list: prof });
  }, 'pEmit');

  /* ---- 1 sn'lik tik: süre dolanlar, nabız, kart, yeniden bağlanma ---- */
  const pTick = guard(function () {
    const t = now(), gap = t - P.lastTick; P.lastTick = t;
    if (!P.on || P.halt) return;
    if (gap > 4000) { P.warmUntil = t + WARM_MS; const m = pMq(); if (m) m.probe(); }   // askıdan dönüş: liste bayat olabilir, bildirim yok
    if (P.mq) P.mq.tick(t);
    let ch = false;
    for (const pid in P.peers) {
      const e = P.peers[pid]; let any = false;
      for (const s in e.sns) { if (e.sns[s] <= t) delete e.sns[s]; else any = true; }
      if (!any) { pGone(pid); ch = true; }
    }
    if (ch) pChanged();
    if (gap > 4000 || (t % 60000) < 1100) {                       // dakikada bir: eski sınır kayıtlarını ve kartı olmayanların son görülmesini temizle
      for (const T of [P.gone, P.cameAt, P.lobAt]) for (const k in T) if (t - T[k] > CAME_GAP) delete T[k];
      const wall = Date.now(); for (const k in P.ls) if (!P.cards[k] && !P.peers[k] && wall - P.ls[k] > 3600000) delete P.ls[k];
    }
    if (!pMq()) { if (!P.mq && !P.timer) pRoute(); if (P.prDirty) pEmit(); return; }
    if (P.subMq !== pMq()) pRoute();
    const iv = pHiddenLong() ? HB_AWAY_MS : HB_MS;
    if (t - P.lastHb >= iv || (t - P.lastHb >= 1000 && pBeatSig() !== P.hbSig)) pBeat();
    if (!P.hiddenAt && t - P.lastCard >= CARD_MS) pCardPub(1);   // görünürken dakikada bir: son görülme dakika hassasiyetinde
    else if (P.cardDirty) pCardPub(0);
    if (P.homeT && t > P.homeT && P.mq && !pShared()) { P.homeT = 0; P.ord = 0; P.att = 0; pStopOwn(); pRoute(); }
    if (P.prDirty) pEmit();
  }, 'pTick');
  function pEnable(on) {
    if (on) {
      if (P.on || typeof WebSocket === 'undefined') return P.on;
      P.on = true; P.halt = false; P.warmUntil = now() + WARM_MS; P.lastTick = now(); P.cardDirty = true;
      if (!P.iv && typeof setInterval === 'function') P.iv = setInterval(pTick, 1000);
      pRoute();
      return true;
    }
    if (!P.on) return false;
    const me = myPid();
    pSend('_on/' + me, { pid: me, st: 'off', sn: SN, v: VER }, false, true);
    P.on = false;
    if (P.subMq && P.subMq === C.mq && connected()) { C.mq.unsubscribe(PR_ON + '+'); C.mq.unsubscribe(PR_PR + '+'); }
    pStopOwn(); P.subMq = null;
    clearInterval(P.iv); P.iv = null;
    P.peers = {};
    pSetConn('off'); pChanged();
    return false;
  }
  function pHidden(h) {
    if (!P.on || P.halt) return;
    if (h) { P.hiddenAt = now(); pBeat(true); pCardPub(1); return; }     // gizlenme anı = son görülme
    // askıya alınmış sayfanın bayat listesi için ısınmayı tik boşluğu (pTick) başlatır; sadece gizli kalmak liste bayatlatmaz
    const away = P.hiddenAt ? now() - P.hiddenAt : 0; P.hiddenAt = 0;
    const m = pMq(); if (m) { m.probe(); pBeat(true); if (away > 10000) pCardPub(1); } else pRoute();
  }
  // sayfa kapanıyor: önce son görülme kartı + 'off' (paylaşılan bağlantı oda çıkışıyla kapanmadan), sonra varlık durur
  function pPageHide() {
    if (!P.on || P.halt) return;
    const me = myPid();
    pCardPub(2);
    pSend('_on/' + me, { pid: me, st: 'off', sn: SN, v: VER }, false, true);
    P.halt = true; pStopOwn(); P.subMq = null; P.conn = 'off';
  }
  function pPageShow() { if (P.on && P.halt) { P.halt = false; P.warmUntil = now() + WARM_MS; P.lastTick = now(); pRoute(); } }
  function pOnline() { if (P.on && !P.halt && !pMq()) { P.att = 0; clearTimeout(P.timer); P.timer = null; if (P.mq) { const m = P.mq; P.mq = null; m.end('çevrimiçi', true); } pRoute(); } }

  /* ---------------- sayfa yaşam döngüsü ---------------- */
  function onVisible() {
    if (!R.phase) return;
    const away = R.hiddenAt ? now() - R.hiddenAt : 0; R.hiddenAt = 0;
    if (away > 2500) onResume('görünür (' + Math.round(away) + ' ms uzaktaydı)');
    else if (connected()) C.mq.probe();
    else if (C.want && !C.mq) reconnectNow('görünür');
  }
  try {
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', guard(function () {
        if (document.hidden) { R.hiddenAt = now(); if (R.phase === 'in') { if (connected()) sendPing(); rjWrite(); } pHidden(true); }
        else { onVisible(); pHidden(false); }
      }, 'visibility'));
    }
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('online', guard(function () { if (C.want && !connected()) { C.att = 0; reconnectNow('çevrimiçi'); } pOnline(); }, 'online'));
      window.addEventListener('pagehide', guard(function (ev) {
        emit('net:pagehide', { persisted: !!(ev && ev.persisted) });   // netgame: yarış konumunu kaydet (oda kapanmadan önce)
        pPageHide();
        if (!R.phase) return;
        if (R.phase === 'in') rjWrite({ closed: Date.now() });     // yenileme / kapanma: geri dönüş kaydı kalır (bilerek çıkış değil)
        if (ev && ev.persisted && R.phase === 'in') {               // bfcache: odayı hatırla, dönünce yeniden katıl
          const keep = { code: R.code, broker: C.bi };
          leave(false, true);
          R.resume = keep;
        } else leave(false, true);
      }, 'pagehide'));
      window.addEventListener('pageshow', guard(function (ev) {
        if (!(ev && ev.persisted)) return;
        pPageShow();
        if (R.resume && !R.phase) { const k = R.resume; R.resume = null; joinRoom(k.code, { rejoin: true, broker: k.broker }); }
      }, 'pageshow'));
    }
  } catch (e) { }

  /* =================== genel API =================== */
  function joinRoom(input, opts) {
    opts = isObj(opts) ? opts : {};
    if (typeof WebSocket === 'undefined') { error('nows'); return false; }
    const pc = parseCode(input);
    if (!pc) { error('badcode'); return false; }
    if (R.phase) leave(false);
    ensureId();
    resetRoom();
    if (isObj(opts.profile)) R.prof = Object.assign({}, opts.profile);
    R.phase = 'joining'; R.code = pc.code; R.base = ROOT + pc.code + '/'; R.codeBi = pc.broker; R.joinRetry = 0; R.rejoin = !!opts.rejoin;
    // opts.broker: odanın en son bulunduğu aracı ("odaya geri dön" kaydı; oda yedeğe geçmiş olabilir). Bulunamazsa kodun aracısı denenir.
    const bi = fin(opts.broker) && opts.broker >= 0 && opts.broker < BROKERS.length ? opts.broker | 0 : pc.broker;
    startTick();
    statusChanged();
    startConnect(bi, 3, false);
    if (R.rejoin) emit('net:rejoining', { code: pc.code });
    return true;
  }
  function createRoom(opts) {
    opts = isObj(opts) ? opts : {};
    if (typeof WebSocket === 'undefined') { error('nows'); return false; }
    if (R.phase) leave(false);
    ensureId();
    resetRoom();
    if (isObj(opts.profile)) R.prof = Object.assign({}, opts.profile);
    R.cfg0 = isObj(opts.cfg) ? clone(opts.cfg) : {};
    R.phase = 'creating'; R.rand4 = rnd(4, ALPHA);
    const pref = (typeof opts.broker === 'number' && opts.broker >= 0 && opts.broker < BROKERS.length) ? opts.broker | 0 : PREF[0];
    startTick();
    statusChanged();
    startConnect(pref, 1, false);
    return true;
  }

  const NET = FM.net = {
    VER, MAX: MAXP, BROKERS: BROKERS.map(b => ({ n: b.n, url: b.url, stMs: b.stMs })), PREF: PREF.slice(), ERR,
    debug: false,
    available: () => typeof WebSocket !== 'undefined',
    pid: guard(() => myPid(), 'pid', 'p0'),
    nick: guard(() => myNick(), 'nick', 'Oyuncu'),
    // takma adı kaydeder (temizler, en fazla 14 karakter). Odadaysa diğerlerine de bildirir.
    setNick: guard(function (n) {
      const c = cleanNick(n); if (!c) return false;
      ensureId(); FM.save.nick = c; FM.save.nickSet = true; if (typeof FM.persist === 'function') FM.persist();
      if (R.prof) delete R.prof.nick;
      P.cardDirty = true; P.myCardT = -1e9;
      profileChanged();
      return true;
    }, 'setNick', false),
    now: () => now(),
    status: guard(statusObj, 'status', null),
    statusText: guard(function () {
      if (C.conn === 'connecting') return R.phase === 'creating' ? 'Oda kuruluyor…' : 'Bağlanıyor…';
      if (C.conn === 'reconnecting') return 'Bağlantı koptu, yeniden bağlanılıyor…';
      if (R.phase === 'joining') return 'Odaya katılınıyor…';
      if (R.phase === 'in') return R.role === 'host' ? 'Oda açık — ev sahibisin' : 'Odadasın';
      return 'Çevrimdışı';
    }, 'statusText', ''),
    inRoom: () => R.phase === 'in',
    busy: () => !!R.phase,
    isHost: () => R.phase === 'in' && R.role === 'host',
    code: () => R.code,
    host: () => R.hostPid,
    rtt: () => Math.round(R.rtt),
    alive: guard(id => alive(id), 'alive', false),
    lobby: guard(lobbyView, 'lobby', null),
    players: guard(playersList, 'players', []),
    config: guard(() => (R.lob ? clone(R.lob.cfg) || {} : {}), 'config', {}),
    parseCode: guard(parseCode, 'parseCode', null),
    // Paylaşılacak link: sayfanın kendi adresi + ?oda=KOD (diğer parametreler atılır)
    shareLink: guard(function (code) {
      const c = parseCode(code || R.code); if (!c) return '';
      let base = '';
      try { base = String(location.href).split('#')[0].split('?')[0]; } catch (e) { base = ''; }
      return base + '?oda=' + c.code;
    }, 'shareLink', ''),
    // Açılış linkindeki ?oda=KOD (geçerliyse kod, değilse null). UI bununla otomatik katılmayı başlatır.
    codeFromUrl: guard(function () { const p = FM.params || {}; return p.oda ? (parseCode(p.oda) || {}).code || null : null; }, 'codeFromUrl', null),
    clearUrlCode: guard(function () {
      try { const u = new URL(location.href); if (u.searchParams.has('oda')) { u.searchParams.delete('oda'); history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash); } } catch (e) { }
      return true;
    }, 'clearUrlCode', false),
    createRoom: guard(createRoom, 'createRoom', false),
    joinRoom: guard(joinRoom, 'joinRoom', false),
    // bilerek çıkış: "odaya geri dön" kaydı da silinir
    leaveRoom: guard(function () { leave(false); rjClear(); return true; }, 'leaveRoom', false),
    /* ---- odaya geri dönüş (TUR5 §7) ---- */
    // son odanın kaydı (15 dk içinde, bu kimlikle): {code, broker, t, pid, hn (ev sahibinin adı), live, closed, host} | null
    lastRoom: guard(lastRoom, 'lastRoom', null),
    forgetRoom: guard(function () { rjClear(); return true; }, 'forgetRoom', false),
    /* ---- varlık: çevrimiçi listesi + profil kartları (TUR5 §8) ---- */
    // [{pid, nick, char, skin, st: 'menu'|'lobby'|'race'|'solo'|'away', code, n, max, open, me, age}] — kendin dahil (ilk sırada); bağlı değilse []
    online: guard(onlineList, 'online', []),
    // [{pid, nick, char, skin, lvl, tr, play, races, wins, kills, best, since, lg, ls, online, st, away, code, me}] — bilinen herkes; çevrimiçiler önce
    profiles: guard(profilesList, 'profiles', []),
    // presence() → durum; presence(true/false) → aç/kapat. Durum: {on, conn: 'off'|'connecting'|'open'|'offline', shared, broker, brokerName, n}
    presence: guard(function (on) { if (on !== undefined) pEnable(!!on); return pStatus(); }, 'presence', null),
    setProfile: guard(function (p) {
      if (!isObj(p)) return false;
      R.prof = Object.assign(R.prof || {}, p);
      P.cardDirty = true; P.myCardT = -1e9;
      profileChanged(); return true;
    }, 'setProfile', false),
    setReady: guard(function (b) { R.ready = !!b; profileChanged(); return true; }, 'setReady', false),
    // ev sahibi: oda ayarları (mod, harita, tur, botlar...). Sığ birleştirme; null değer anahtarı siler.
    setConfig: guard(function (cfg) {
      if (R.role !== 'host' || R.phase !== 'in' || !isObj(cfg)) return false;
      const c = R.lob.cfg = isObj(R.lob.cfg) ? R.lob.cfg : {};
      for (const k in cfg) { if (cfg[k] === null) delete c[k]; else c[k] = clone(cfg[k]); }
      lobbyChanged(false); return true;
    }, 'setConfig', false),
    start: guard(d => hostCtl('start', d), 'start', false),
    next: guard(d => hostCtl('next', d), 'next', false),
    end: guard(d => hostCtl('end', d), 'end', false),
    toLobby: guard(d => hostCtl('lobby', d), 'toLobby', false),
    kick: guard(function (id) {
      if (R.role !== 'host' || R.phase !== 'in' || !tok(id, null) || id === myPid()) return false;
      if (!hostCtlRaw('kick', { to: id })) return false;
      const L = R.lob; L.p = L.p.filter(p => p.id !== id);
      if (L.x.indexOf(id) < 0) { L.x.push(id); if (L.x.length > 30) L.x.shift(); }
      lobbyChanged(true); return true;
    }, 'kick', false),
    // Kendi durumunu (ve ev sahibiyse botlarınkini: {botId: durum}) yayınla. Her karede çağrılabilir; ~10 Hz'e kısılır.
    sendState: guard(function (s, bots) {
      if (R.phase !== 'in' || !connected() || !isObj(s)) return false;
      R.pend = { t: now(), s, b: isObj(bots) ? bots : null };
      const el = now() - R.lastState, iv = bk().stMs;
      if (R.stTimer) return true;                     // zaten planlı: o anda en güncel durum gider
      if (el >= iv - 4) flushState();
      else R.stTimer = setTimeout(flushState, iv - el);
      return true;
    }, 'sendState', false),
    sample: guard(sample, 'sample', null),
    latest: guard(function (id) { const b = bufs[id]; return b && b.arr.length ? Object.assign({}, b.arr[b.arr.length - 1].d) : null; }, 'latest', null),
    buffer: guard(function (id) { const b = bufs[id]; return b ? b.arr.map(e => ({ t: e.t, d: e.d })) : []; }, 'buffer', []),
    delay: guard(function (id) { const b = bufs[id], o = b && offs[b.src]; return o ? Math.round(o.dly) : 130; }, 'delay', 130),
    // Olay kanalı (eşya, güç, ölüm, bitiş, kapı...). Saniyede ~20 ile sınırlı.
    sendEvent: guard(function (type, data) {
      if (R.phase !== 'in' || !connected() || !tok(type, null)) return false;
      const t = now(); R.evTok = Math.min(30, R.evTok + (t - R.evT) / 50); R.evT = t;
      if (R.evTok < 1) return false; R.evTok -= 1;
      const m = { f: myPid(), e: type, t: Math.round(t * 10) / 10, d: isObj(data) ? data : {} };
      const s = JSON.stringify(m); if (s.length > 8192) return false;
      return pub('ev', s);
    }, 'sendEvent', false),
    emoji: guard(function (e) {
      const c = cleanEmoji(e); if (!c || R.phase !== 'in' || !connected()) return false;
      const t = now(); if (t - R.emoT < 700) return false; R.emoT = t;
      if (!pub('ev', { f: myPid(), e: 'emoji', t: Math.round(t), d: { e: c } })) return false;
      emit('net:emoji', { from: myPid(), e: c, me: true, lat: 0 });
      return true;
    }, 'emoji', false),
    log: () => logBuf.slice(),
    // Yarışçı <-> kısa anahtarlı anlık görüntü dönüştürücüler (aşağıda)
    FIELDS: null, packRacer: null, applyRacer: null,
    // testler için (oyun KULLANMAZ)
    _dbg: {
      // ani kopma benzetimi: soket DISCONNECT'siz kapanır (aracı Last Will yayınlar), istemci kopmayı fark etmiş gibi davranır
      kill: guard(function () { const m = C.mq; if (m) m.end('test: ani kopma'); return !!m; }, 'kill', false),
      // varlığın KENDİ bağlantısını ani kopar (paylaşılan oda bağlantısına dokunmaz)
      pkill: guard(function () { const m = P.mq; if (m) m.end('test: ani kopma'); return !!m; }, 'pkill', false),
      // sayfa kapanma / gizlenme benzetimi (node testleri; tarayıcıda gerçek olaylar)
      pagehide: guard(function () { emit('net:pagehide', { persisted: false }); pPageHide(); if (R.phase === 'in') rjWrite({ closed: Date.now() }); if (R.phase) leave(false, true); return true; }, 'pagehide', false),
      hidden: guard(function (h) { pHidden(!!h); return true; }, 'hidden', false),
      freeze: null, R, C, P, bufs, offs, SN: () => SN, Mq, packet, mqStr, utf8, fromUtf8, override: OVR
    }
  };
  function profileChanged() {
    if (R.phase !== 'in') return;
    if (R.role === 'host' && R.lob) {
      const me = R.lob.p.find(p => p.id === myPid()), pr = myProfile();
      if (me) { me.n = pr.n; me.c = pr.c; me.sk = pr.sk; me.tr = pr.tr; me.pl = pr.pl; me.rd = R.ready ? 1 : 0; }
      lobbyChanged(false);
    } else sendJoin(false);
  }

  /* ---- test: donma benzetimi (telefon arka planda / sekme uyutuldu) ---- */
  let frozen = false;
  NET._dbg.freeze = guard(function (on) {
    if (on && !frozen) {
      frozen = true;
      if (R.tickTimer) { clearInterval(R.tickTimer); R.tickTimer = null; }
      if (C.mq) { C.mq._onMsg = C.mq.o.onMsg; C.mq.o.onMsg = function () { }; C.mq._raw = C.mq.raw; C.mq.raw = function () { return false; }; }
    } else if (!on && frozen) {
      frozen = false;
      if (C.mq && C.mq._raw) { C.mq.raw = C.mq._raw; C.mq.o.onMsg = C.mq._onMsg; }
      R.lastTick = now() - 5000;     // bir sonraki tik "askıdan dönüş" algılasın
      if (R.phase && !R.tickTimer && typeof setInterval === 'function') R.tickTimer = setInterval(tick, 500);
      tick();
    }
    return frozen;
  }, 'freeze', false);

  /* =================== yarışçı anlık görüntüsü (öneri) ===================
     [yarışçı alanı, kısa anahtar, tür]  tür: p = konum (0.1 hassasiyet), i = tam sayı, t = süre (0.01), b = 0/1, s = metin|null
     Varsayılan değerler (0 / false / null) GÖNDERİLMEZ; applyRacer eksik anahtarı varsayılana çevirir. */
  const FIELDS = [
    ['x', 'x', 'p'], ['y', 'y', 'p'], ['vx', 'vx', 'i'], ['vy', 'vy', 'i'], ['h', 'h', 'i'], ['face', 'fc', 'i'],
    ['onGround', 'g', 'b'], ['slide', 'sl', 'b'], ['climb', 'cl', 'b'], ['slam', 'sm', 'b'], ['jumps', 'ju', 'i'],
    ['fly', 'fl', 't'], ['dash', 'da', 't'], ['sled', 'se', 't'], ['shield', 'sh', 't'], ['balloon', 'bl', 'b'],
    ['boost', 'bo', 't'], ['padT', 'pd', 't'], ['frozen', 'fr', 't'], ['stun', 'st', 't'], ['netted', 'nt', 't'],
    ['dead', 'dd', 't'], ['inv', 'iv', 't'], ['inked', 'ik', 't'], ['slowT', 'sw', 't'], ['pull', 'pu', 't'],
    ['finished', 'fi', 'b'], ['place', 'pc', 'i'], ['ftime', 'ft', 't'], ['item', 'it', 's'], ['charge', 'ch', 'i'],
    ['coins', 'co', 'i'], ['kills', 'k', 'i'], ['deaths', 'de', 'i'], ['tp', 'j', 'i'], ['elim', 'el', 'b'], ['spec', 'sp', 'b']
  ];
  const ALWAYS = { x: 1, y: 1, vx: 1, vy: 1, h: 1 };
  NET.FIELDS = FIELDS.map(f => f.slice());
  NET.packRacer = guard(function (r, extra) {
    if (!r) return null;
    const o = {};
    for (const f of FIELDS) {
      let v = r[f[0]];
      switch (f[2]) {
        case 'p': v = typeof v === 'number' && isFinite(v) ? Math.round(v * 10) / 10 : 0; break;
        case 'i': v = typeof v === 'number' && isFinite(v) ? Math.round(v) : 0; break;
        case 't': v = typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0; break;
        case 'b': v = v ? 1 : 0; break;
        case 's': v = typeof v === 'string' ? v : null; break;
      }
      if (ALWAYS[f[0]] || (v !== 0 && v !== null)) o[f[1]] = v;
    }
    if (isObj(extra)) for (const k in extra) o[k] = extra[k];
    return o;
  }, 'packRacer', null);
  NET.applyRacer = guard(function (r, d) {
    if (!r || !isObj(d)) return r;
    for (const f of FIELDS) {
      const v = d[f[1]];
      switch (f[2]) {
        case 'p': case 'i': case 't': if (typeof v === 'number' && isFinite(v)) r[f[0]] = v; else if (!ALWAYS[f[0]]) r[f[0]] = 0; break;
        case 'b': r[f[0]] = !!v; break;
        case 's': r[f[0]] = (typeof v === 'string' && v.length <= 24 && (f[0] !== 'item' || !FM.ITEMS || own(FM.ITEMS, v))) ? v : null; break;
      }
    }
    if (typeof d.fc === 'number') r.face = d.fc >= 0 ? 1 : -1; else r.face = r.face || 1;
    return r;
  }, 'applyRacer', null);

  /* ---- başlangıç: kimliği hazırla, kayıt sıfırlanınca pid'i koru ---- */
  try { ensureId(); } catch (e) { }
  try {
    if (typeof FM.on === 'function') {
      FM.on('save:reset', function () { ensureId(); P.cardDirty = true; });
      FM.on('meta:card', function () { P.cardDirty = true; P.myCardT = -1e9; });
      for (const ev of ['race:start', 'match:start', 'match:end', 'ui:menu', 'mp:lobby']) FM.on(ev, function () { try { pSoon(); } catch (e) { } });
      // Varlık oyun açılınca başlar (main.js 'boot'; node testleri/hayaletler 'boot' yayınlamaz → presence(true) ile açılır).
      // ?pres=0 kapatır. Geliştirici modunda (dev=1) herkese açık aracılara gereksiz bağlanmamak için yalnız ?brokerUrl= ya da ?pres=1 ile.
      FM.on('boot', guard(function () {
        const q = FM.params || {};
        if (q.pres === '0') return;
        if (FM.DEV && !OVR && q.pres !== '1') return;
        pEnable(true);
      }, 'boot'));
    }
  } catch (e) { }

})(window.FM);
