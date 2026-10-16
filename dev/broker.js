// Kullanım: node dev/broker.js [port=1884] [--delay=MS] [--log]
//   → ws://127.0.0.1:PORT/mqtt adresinde YEREL test aracısı (MQTT 3.1.1, WebSocket alt protokolü 'mqtt').
//   Oyunu buna bağlamak için: index.html?dev=1&brokerUrl=ws://127.0.0.1:PORT/mqtt  (net.js tüm aracıları bununla değiştirir)
//   Node testleri: NET_BROKER=ws://127.0.0.1:PORT/mqtt node dev/net-test.js yerel   (ya da betikler aracıyı kendileri başlatır)
// Bağımlılıksız (yalnız http + crypto). Desteklenen: CONNECT/CONNACK (Last Will dahil), SUBSCRIBE/SUBACK (+ ve # joker),
// UNSUBSCRIBE/UNSUBACK, PUBLISH QoS 0 (QoS 1/2 gelirse onaylanır, dağıtım QoS 0), retain (boş yük = retain silme),
// PINGREQ/PINGRESP, DISCONNECT (temiz çıkış → will yok), anormal kapanışta ve keepalive×1.5 sessizlikte Last Will,
// aynı istemci kimliğiyle ikinci bağlantıda eskisini kapatma. WebSocket: el sıkışma, maskeli istemci çerçeveleri,
// parçalı (continuation) mesajlar, ping/pong, close. --delay=MS: her teslimata yapay gecikme (gerçek aracı benzetimi).
// Bu bulut ortamı herkese açık aracılara bağlanamadığı için çok oyunculu testler bununla yapılır (docs/TUR5.md §10).
'use strict';
const http = require('http'), crypto = require('crypto');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PKT = 512 * 1024;

/* ---------- MQTT yardımcıları ---------- */
function encLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return Buffer.from(o); }
function mqStr(s) { const b = Buffer.isBuffer(s) ? s : Buffer.from(String(s), 'utf8'); const h = Buffer.alloc(2); h.writeUInt16BE(b.length, 0); return Buffer.concat([h, b]); }
function packet(h, parts) { const body = Buffer.concat(parts); return Buffer.concat([Buffer.from([h]), encLen(body.length), body]); }
// konu süzgeci eşleşmesi: '+' bir seviye, '#' kalan her şey (üst seviyenin kendisi dahil); '$' ile başlayan konular jokerle eşleşmez
function match(filter, topic) {
  if (topic[0] === '$' && (filter[0] === '+' || filter[0] === '#')) return false;
  const f = filter.split('/'), t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
function validFilter(f) {
  if (typeof f !== 'string' || !f.length || f.length > 1024) return false;
  const p = f.split('/');
  for (let i = 0; i < p.length; i++) {
    if (p[i].indexOf('#') >= 0 && (p[i] !== '#' || i !== p.length - 1)) return false;
    if (p[i].indexOf('+') >= 0 && p[i] !== '+') return false;
  }
  return true;
}

/* ---------- WebSocket çerçeveleri (sunucu → istemci maskesiz) ---------- */
function wsFrame(op, payload) {
  const n = payload.length; let h;
  if (n < 126) { h = Buffer.alloc(2); h[1] = n; }
  else if (n < 65536) { h = Buffer.alloc(4); h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[1] = 127; h.writeUInt32BE(Math.floor(n / 4294967296), 2); h.writeUInt32BE(n >>> 0, 6); }
  h[0] = 0x80 | op;
  return Buffer.concat([h, payload]);
}

function start(opts) {
  opts = opts || {};
  const delay = Math.max(0, +opts.delay || 0), logOn = !!opts.log;
  const log = (...a) => { if (logOn) console.log('[aracı]', ...a); };
  const clients = new Set();
  const byId = new Map();
  const retained = new Map();                     // konu → Buffer (yük)
  const stats = { conn: 0, pubIn: 0, msgOut: 0, wills: 0, retained: 0 };

  function Client(sock) {
    this.sock = sock; this.wsBuf = Buffer.alloc(0); this.frag = []; this.mq = Buffer.alloc(0);
    this.id = null; this.subs = new Map(); this.will = null; this.keep = 0; this.lastRx = Date.now();
    this.connected = false; this.closed = false; this.clean = false;
  }
  Client.prototype.sendRaw = function (buf) {
    if (this.closed) return;
    try { this.sock.write(wsFrame(2, buf)); } catch (e) { }
  };
  Client.prototype.deliver = function (buf) {
    if (!delay) { this.sendRaw(buf); return; }
    setTimeout(() => this.sendRaw(buf), delay);
  };
  Client.prototype.close = function (abnormal, why) {
    if (this.closed) return;
    this.closed = true;
    clients.delete(this);
    if (this.id && byId.get(this.id) === this) byId.delete(this.id);
    log('kapandı', this.id, abnormal ? '(anormal: ' + why + ')' : '(temiz)');
    if (abnormal && this.connected && this.will && !this.clean) { stats.wills++; route(this.will.topic, this.will.payload, this.will.retain); }
    try { this.sock.write(wsFrame(8, Buffer.from([0x03, 0xe8]))); } catch (e) { }
    try { this.sock.end(); } catch (e) { }
    setTimeout(() => { try { this.sock.destroy(); } catch (e) { } }, 200);
  };

  // yayını eşleşen tüm abonelere ilet (istemci başına bir kez); retain ise sakla / boş yükle sil
  function route(topic, payload, retain) {
    stats.pubIn++;
    if (retain) {
      if (!payload.length) retained.delete(topic); else retained.set(topic, payload);
      stats.retained = retained.size;
    }
    const pkt = packet(0x30, [mqStr(topic), payload]);
    for (const c of clients) {
      if (!c.connected) continue;
      for (const f of c.subs.keys()) if (match(f, topic)) { c.deliver(pkt); stats.msgOut++; break; }
    }
  }

  function onMqtt(c, h, b) {
    const type = h >> 4;
    c.lastRx = Date.now();
    if (!c.connected && type !== 1) { c.close(true, 'CONNECT gelmeden paket'); return; }
    switch (type) {
      case 1: {                                                        // CONNECT
        if (c.connected) { c.close(true, 'ikinci CONNECT'); return; }
        let p = 0; const rd16 = () => { const v = b.readUInt16BE(p); p += 2; return v; };
        const rdStr = () => { const n = rd16(); const s = b.slice(p, p + n); p += n; return s; };
        const proto = rdStr().toString('utf8'), lvl = b[p++], flags = b[p++]; c.keep = rd16();
        if ((proto !== 'MQTT' || lvl !== 4) && (proto !== 'MQIsdp' || lvl !== 3)) { c.sendRaw(packet(0x20, [Buffer.from([0, 1])])); c.close(false, 'protokol'); return; }
        let id = rdStr().toString('utf8');
        if (flags & 0x04) { const wt = rdStr().toString('utf8'), wp = rdStr(); c.will = { topic: wt, payload: Buffer.from(wp), retain: !!(flags & 0x20) }; }
        if (flags & 0x80) rdStr();
        if (flags & 0x40) rdStr();
        if (!id) id = 'yerel-' + crypto.randomBytes(6).toString('hex');
        const old = byId.get(id);
        if (old && old !== c) old.close(true, 'aynı istemci kimliği');
        c.id = id; byId.set(id, c); c.connected = true; stats.conn++;
        c.sendRaw(packet(0x20, [Buffer.from([0, 0])]));
        log('bağlandı', id, 'keepalive', c.keep, c.will ? 'will=' + c.will.topic : '');
        break;
      }
      case 3: {                                                        // PUBLISH
        const qos = (h >> 1) & 3, retain = !!(h & 1);
        if (b.length < 2) return;
        const tl = b.readUInt16BE(0); if (2 + tl > b.length) return;
        const topic = b.slice(2, 2 + tl).toString('utf8'); let p = 2 + tl;
        let pid = null; if (qos > 0) { if (p + 2 > b.length) return; pid = b.slice(p, p + 2); p += 2; }
        if (!topic || topic.indexOf('+') >= 0 || topic.indexOf('#') >= 0) { c.close(true, 'joker içeren yayın konusu'); return; }
        const payload = Buffer.from(b.slice(p));
        if (qos === 1) c.sendRaw(packet(0x40, [pid])); else if (qos === 2) c.sendRaw(packet(0x50, [pid]));
        route(topic, payload, retain);
        break;
      }
      case 6: if (b.length >= 2) c.sendRaw(packet(0x70, [b.slice(0, 2)])); break;            // PUBREL → PUBCOMP
      case 8: {                                                        // SUBSCRIBE
        if (b.length < 2) return;
        const pid = b.slice(0, 2); let p = 2; const codes = [], add = [];
        while (p + 2 <= b.length) {
          const n = b.readUInt16BE(p); p += 2; const f = b.slice(p, p + n).toString('utf8'); p += n; p++;  // istenen QoS (yok sayılır)
          if (validFilter(f)) { c.subs.set(f, 0); codes.push(0); add.push(f); } else codes.push(0x80);
        }
        c.sendRaw(packet(0x90, [pid, Buffer.from(codes)]));
        // abonelikle eşleşen retain mesajları (retain bayrağıyla) — aynı konu birden çok süzgeçle eşleşse de bir kez
        const sent = new Set();
        for (const f of add) for (const [t, pl] of retained) if (!sent.has(t) && match(f, t)) { sent.add(t); c.deliver(packet(0x31, [mqStr(t), pl])); stats.msgOut++; }
        break;
      }
      case 10: {                                                       // UNSUBSCRIBE
        if (b.length < 2) return;
        const pid = b.slice(0, 2); let p = 2;
        while (p + 2 <= b.length) { const n = b.readUInt16BE(p); p += 2; c.subs.delete(b.slice(p, p + n).toString('utf8')); p += n; }
        c.sendRaw(packet(0xB0, [pid]));
        break;
      }
      case 12: c.sendRaw(Buffer.from([0xD0, 0])); break;               // PINGREQ → PINGRESP
      case 14: c.clean = true; c.close(false, 'DISCONNECT'); break;   // temiz çıkış: will yok
      default: break;                                                  // PUBACK/PUBREC/PUBCOMP vb.: yok say
    }
  }
  // WebSocket ikili yükleri bir bayt akışıdır: MQTT paketleri mesaj sınırlarından bağımsız birleştirilir
  function feedMqtt(c, data) {
    c.mq = c.mq.length ? Buffer.concat([c.mq, data]) : data;
    let off = 0;
    for (;;) {
      if (c.mq.length - off < 2) break;
      let len = 0, mul = 1, i = off + 1, fin = false;
      for (let k = 0; k < 4 && i < c.mq.length; k++) { const x = c.mq[i++]; len += (x & 127) * mul; mul *= 128; if (!(x & 128)) { fin = true; break; } }
      if (!fin) { if (i - off - 1 >= 4) { c.close(true, 'bozuk uzunluk'); return; } break; }
      if (len > MAX_PKT) { c.close(true, 'çok büyük paket'); return; }
      if (i + len > c.mq.length) break;
      try { onMqtt(c, c.mq[off], c.mq.slice(i, i + len)); } catch (e) { c.close(true, 'ayrıştırma: ' + e.message); return; }
      if (c.closed) return;
      off = i + len;
    }
    c.mq = off < c.mq.length ? c.mq.slice(off) : Buffer.alloc(0);
  }
  function feedWs(c, data) {
    c.wsBuf = c.wsBuf.length ? Buffer.concat([c.wsBuf, data]) : data;
    for (;;) {
      const b = c.wsBuf; if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let n = b[1] & 0x7f, p = 2;
      if (n === 126) { if (b.length < 4) return; n = b.readUInt16BE(2); p = 4; }
      else if (n === 127) { if (b.length < 10) return; n = b.readUInt32BE(2) * 4294967296 + b.readUInt32BE(6); p = 10; }
      if (n > MAX_PKT * 2) { c.close(true, 'çok büyük çerçeve'); return; }
      if (!masked) { c.close(true, 'maskesiz istemci çerçevesi'); return; }
      if (b.length < p + 4 + n) return;
      const mask = b.slice(p, p + 4); p += 4;
      const pl = Buffer.alloc(n); for (let i = 0; i < n; i++) pl[i] = b[p + i] ^ mask[i & 3];
      c.wsBuf = b.slice(p + n);
      if (op === 8) { c.close(true, 'WebSocket close'); return; }
      if (op === 9) { try { c.sock.write(wsFrame(10, pl)); } catch (e) { } continue; }
      if (op === 10) continue;
      if (op === 1) { c.close(true, 'metin çerçevesi'); return; }
      if (op === 2 || op === 0) {
        c.frag.push(pl);
        if (fin) { const all = c.frag.length === 1 ? c.frag[0] : Buffer.concat(c.frag); c.frag = []; feedMqtt(c, all); if (c.closed) return; }
      }
    }
  }

  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Fuat Morel yerel MQTT aracısı: ws://' + req.headers.host + '/mqtt\n'); });
  server.on('upgrade', (req, sock) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
    const protos = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim()).filter(Boolean);
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    const hdr = ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + accept];
    if (protos.length) hdr.push('Sec-WebSocket-Protocol: ' + (protos.indexOf('mqtt') >= 0 ? 'mqtt' : protos[0]));
    sock.write(hdr.join('\r\n') + '\r\n\r\n');
    sock.setNoDelay(true);
    const c = new Client(sock); clients.add(c);
    sock.on('data', d => { if (!c.closed) feedWs(c, d); });
    sock.on('close', () => c.close(true, 'soket kapandı'));
    sock.on('error', () => c.close(true, 'soket hatası'));
  });
  // keepalive: 1.5 × keepalive boyunca paket gelmezse bağlantıyı kopmuş say (Last Will)
  const kt = setInterval(() => { const t = Date.now(); for (const c of clients) if (c.connected && c.keep > 0 && t - c.lastRx > c.keep * 1500) c.close(true, 'keepalive'); }, 1000);
  if (kt.unref) kt.unref();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port || 0, opts.host || '127.0.0.1', () => {
      const port = server.address().port;
      const url = 'ws://127.0.0.1:' + port + '/mqtt';
      resolve({
        url, port, stats, server, retained,
        clients: () => clients.size,
        // test: tüm istemci bağlantılarını anormal kapat (aracı çöktü benzetimi; Last Will yayınlanmaz çünkü aracının kendisi gidiyor)
        dropAll: () => { for (const c of Array.from(clients)) { c.closed = true; clients.delete(c); try { c.sock.destroy(); } catch (e) { } } byId.clear(); },
        close: () => new Promise(res => {
          clearInterval(kt);
          for (const c of Array.from(clients)) { c.closed = true; try { c.sock.destroy(); } catch (e) { } }
          clients.clear(); byId.clear();
          server.close(() => res());
          setTimeout(res, 500);
        })
      });
    });
  });
}

module.exports = { start, match };

if (require.main === module) {
  const args = process.argv.slice(2);
  const port = +(args.find(a => /^\d+$/.test(a)) || 1884);
  const dl = args.find(a => a.startsWith('--delay='));
  start({ port, delay: dl ? +dl.split('=')[1] : 0, log: args.includes('--log') }).then(b => {
    console.log('Yerel MQTT aracısı hazır: ' + b.url);
    console.log('Oyun:  index.html?dev=1&brokerUrl=' + b.url);
    console.log('Durdurmak için Ctrl+C');
    const st = setInterval(() => { if (args.includes('--log')) console.log('[aracı] bağlı ' + b.clients() + ', yayın ' + b.stats.pubIn + ', teslimat ' + b.stats.msgOut + ', retain ' + b.stats.retained); }, 10000);
    process.on('SIGINT', () => { clearInterval(st); b.close().then(() => process.exit(0)); });
    process.on('SIGTERM', () => { clearInterval(st); b.close().then(() => process.exit(0)); });
  }).catch(e => { console.error('Aracı başlatılamadı:', e.message); process.exit(1); });
}
