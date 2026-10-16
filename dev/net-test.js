// Kullanım: node dev/net-test.js [aracı: 0 | 1 | 2 | all | cerceve | yerel]   (0 EMQX, 1 Mosquitto, 2 HiveMQ; varsayılan all; cerceve = yalnız çevrimdışı)
//   yerel = dev/broker.js ile bu süreçte yerel aracı başlatır (herkese açık aracıya ulaşılamayan ortamlar); ya da NET_BROKER=ws://.../mqtt
//   verilirse tüm istemciler (?brokerUrl=) o aracıya bağlanır. Yerel aracıyla oda testlerine ek olarak VARLIK testleri de koşar.
// Ortam: NET_TEST_DUMP=1 → başarısız adımda istemci durumları + net.log() kuyruğu; NET_TEST_OUT=dosya.json → ölçümleri yaz.
// js/core.js + js/net.js'i her sahte oyuncu için ayrı bir vm bağlamında yükler (Node 24 global WebSocket) ve GERÇEK
// herkese açık MQTT aracısına karşı oda akışını uçtan uca dener: kurma, katılma, lobi eşitlemesi, ayarlar, hazır,
// başlatma, durum akışı (+ ara değerleme), olaylar, emoji, yeniden bağlanma, ev sahibi kısa kopması, ev sahibi düşüp
// göç, eski ev sahibinin geri dönmesi, end/toLobby, aynı pid ikinci oturum, atma, dolu oda reddi, yanlış kod, sürüm
// uyuşmazlığı, oda kapanınca retain temizliği. Gecikmeleri raporlar. Hafif: tek süreç, düşük öncelik.
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const netSrc = fs.readFileSync(path.join(root, 'js', 'net.js'), 'utf8');
if (typeof WebSocket === 'undefined') { console.error('Bu test Node 22+ (global WebSocket) gerektirir.'); process.exit(2); }

let BURL = process.env.NET_BROKER || null;   // yerel/özel aracı (tüm aracı adreslerinin yerine)
const EVTS = ['net:status', 'net:lobby', 'net:players', 'net:start', 'net:end', 'net:next', 'net:toLobby', 'net:event', 'net:host', 'net:error', 'net:kicked', 'net:emoji'];
const clients = [];
function client(name, opts) {
  opts = opts || {};
  const store = opts.store || {};
  const sb = {
    console, Math, Date, JSON, setTimeout, clearTimeout, setInterval, clearInterval, performance, crypto: globalThis.crypto,
    TextEncoder, TextDecoder, WebSocket, URL, URLSearchParams,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search: BURL ? '?brokerUrl=' + encodeURIComponent(BURL) : '', href: 'https://ornek.github.io/fuat-morel/index.html?dev=1#x' },
    navigator: { maxTouchPoints: 0, onLine: true }, history: { replaceState() { }, state: null },
    document: { hidden: false, addEventListener() { } }, addEventListener() { }
  };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(coreSrc, sb, { filename: 'core.js' });
  if (opts.ver) sb.FM.NET_VER = opts.ver;
  vm.runInContext(netSrc, sb, { filename: 'net.js' });
  const FM = sb.FM;
  const c = { name, FM, net: FM.net, store, ev: [], gotStates: {}, lat: [], evLat: [] };
  for (const e of EVTS) FM.on(e, d => c.ev.push({ e, d, t: performance.now() }));
  clients.push(c);
  return c;
}
const last = (c, e) => { for (let i = c.ev.length - 1; i >= 0; i--) if (c.ev[i].e === e) return c.ev[i]; return null; };
const count = (c, e) => c.ev.filter(x => x.e === e).length;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function waitFor(fn, ms, what) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => { let ok = false; try { ok = fn(); } catch (e) { } if (ok) { clearInterval(iv); res(Date.now() - t0); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('zaman aşımı: ' + what)); } }, 40);
  });
}
const stats = a => { if (!a.length) return { n: 0 }; const s = a.slice().sort((x, y) => x - y); const avg = s.reduce((p, q) => p + q, 0) / s.length; return { n: s.length, ort: Math.round(avg), med: Math.round(s[s.length >> 1]), p95: Math.round(s[Math.floor(s.length * .95)]), max: Math.round(s[s.length - 1]) }; };

async function runBroker(bi) {
  const B = ['EMQX', 'Mosquitto', 'HiveMQ'][bi];
  const res = { broker: B, ok: [], fail: [], olc: {} };
  const ok = (m) => { res.ok.push(m); console.log('  ✓ ' + m); };
  const bad = (m) => { res.fail.push(m); console.log('  ✗ ' + m); };
  async function step(name, fn) {
    try { await fn(); } catch (e) {
      bad(name + ' — ' + (e && e.message));
      if (process.env.NET_TEST_DUMP) for (const c of mine) {
        if (!c.net.busy() && !process.env.NET_TEST_DUMP_ALL) continue;
        const st = c.net.status();
        console.log('    [' + c.name + '] pid=' + c.net.pid() + ' faz=' + st.phase + ' rol=' + st.role + ' bağ=' + st.conn + ' ev=' + st.host + ' oyuncu=' + c.net.players().map(p => p.pid.slice(0, 4) + (p.off ? '(off)' : '') + (p.alive ? '' : '(ölü)')).join(','));
        for (const l of c.net.log().slice(-12)) console.log('       ' + l);
      }
    }
  }
  console.log('\n=== Aracı ' + bi + ' (' + B + ') ===');
  const mine = [];
  const mk = (n, o) => { const c = client(n + bi, o); mine.push(c); return c; };

  const A = mk('A'), Bc = mk('B'), Cc = mk('C'), D = mk('D');
  let code = null;
  await step('oda kur', async () => {
    const t0 = performance.now();
    if (!A.net.createRoom({ broker: bi, cfg: { mode: 'classic', rounds: 3 } })) throw new Error('createRoom false');
    await waitFor(() => A.net.inRoom(), 30000, 'ev sahibi odada');
    res.olc.kurma_ms = Math.round(performance.now() - t0);
    code = A.net.code();
    const pc = A.net.parseCode(code);
    if (!pc || pc.broker !== bi) throw new Error('kod aracı indeksi yanlış: ' + code + ' ' + JSON.stringify(pc));
    if (A.net.status().broker !== bi) throw new Error('bağlanılan aracı farklı: ' + A.net.status().broker);
    if (A.net.parseCode(code.toLowerCase()).code !== code) throw new Error('küçük harf kod çözülmedi');
    if (A.net.parseCode('https://x.github.io/fm/index.html?oda=' + code).code !== code) throw new Error('linkten kod çözülmedi');
    const link = A.net.shareLink(code);
    if (link !== 'https://ornek.github.io/fuat-morel/index.html?oda=' + code) throw new Error('shareLink: ' + link);
    ok('oda kuruldu ' + code + ' (' + res.olc.kurma_ms + ' ms), link ' + link);
  });
  if (!code) { for (const c of mine) c.net.leaveRoom(); return res; }

  await step('katılma + lobi eşitlemesi', async () => {
    const t0 = performance.now();
    for (const c of [Bc, Cc, D]) if (!c.net.joinRoom(code)) throw new Error(c.name + ' joinRoom false');
    await waitFor(() => [Bc, Cc, D].every(c => c.net.inRoom()), 30000, 'üç katılan odada');
    res.olc.katilma_ms = Math.round(performance.now() - t0);
    await waitFor(() => [A, Bc, Cc, D].every(c => c.net.players().length === 4 && c.net.host() === A.net.pid()), 8000, 'herkes 4 oyuncu görür');
    const lb = Bc.net.lobby();
    if (!lb || lb.isHost || lb.code !== code || lb.cfg.mode !== 'classic') throw new Error('lobi görünümü: ' + JSON.stringify(lb));
    if (!A.net.isHost() || Bc.net.isHost()) throw new Error('isHost yanlış');
    if (!count(Bc, 'net:lobby') || !count(Bc, 'net:players')) throw new Error('net:lobby/net:players gelmedi');
    ok('3 kişi katıldı (' + res.olc.katilma_ms + ' ms), herkes 4 oyuncu ve aynı ev sahibini görüyor');
  });

  await step('ayar/hazır/profil', async () => {
    A.net.setConfig({ mode: 'elim', theme: 'snow', rounds: 5 });
    Bc.net.setReady(true);
    Cc.net.setProfile({ char: 'Kral', skin: 'altin' });
    D.net.setNick('Dönerci Şükrü');
    await waitFor(() => [A, Bc, Cc, D].every(c => {
      const pl = c.net.players(), b = pl.find(p => p.pid === Bc.net.pid()), cc = pl.find(p => p.pid === Cc.net.pid()), d = pl.find(p => p.pid === D.net.pid());
      return c.net.config().mode === 'elim' && b && b.ready && cc && cc.char === 'Kral' && cc.skin === 'altin' && d && d.nick === 'Dönerci Şükrü';
    }), 8000, 'ayar+hazır+profil herkese yansır');
    if (D.FM.save.nick !== 'Dönerci Şükrü' || D.FM.save.nickSet !== true) throw new Error('nick kayda yazılmadı');
    if (!/^[a-z0-9]{4,16}$/.test(A.FM.save.pid)) throw new Error('pid biçimi: ' + A.FM.save.pid);
    ok('ayar, hazır, karakter/kostüm ve Türkçe takma ad herkese yansıdı');
  });

  // yanlış kod + yok oda + sürüm uyuşmazlığı (paralel)
  const X = mk('X'), Y = mk('Y'), V = mk('V', { ver: 99 });
  const badCode = code.slice(0, 4) + 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.indexOf(code[4]) + 4) % 32];
  await step('yanlış kod', async () => {
    if (X.net.joinRoom(badCode) !== false) throw new Error('geçersiz kod kabul edildi: ' + badCode);
    const e = last(X, 'net:error'); if (!e || e.d.code !== 'badcode') throw new Error('badcode hatası yok');
    if (X.net.joinRoom('AB') !== false) throw new Error('kısa kod kabul edildi');
    ok('geçersiz kod anında reddedildi: "' + e.d.msg + '"');
  });
  let noroomP = null, verP = null;
  {
    // geçerli biçimde ama var olmayan oda
    let ghost; for (;;) { const r4 = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.random() * 32 | 0]).join(''); for (const ch of 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') { const p = Y.net.parseCode(r4 + ch); if (p && p.broker === bi) { ghost = p.code; break; } } if (ghost) break; }
    const t0 = performance.now();
    Y.net.joinRoom(ghost);
    noroomP = waitFor(() => last(Y, 'net:error'), 60000, 'olmayan oda hatası').then(() => ({ code: last(Y, 'net:error').d.code, ms: Math.round(performance.now() - t0) }));
    const t1 = performance.now();
    V.net.joinRoom(code);
    verP = waitFor(() => last(V, 'net:error'), 20000, 'sürüm hatası').then(() => ({ code: last(V, 'net:error').d.code, ms: Math.round(performance.now() - t1) }));
  }

  // ---- başlatma ----
  const payload = { seed: 424242, theme: 2, mode: 'elim', round: 1, rounds: 5, roster: [A, Bc, Cc, D].map(c => ({ pid: c.net.pid(), char: 'TAFTAF' })).concat([{ bot: 1, id: 'b1', char: 'baso' }]), botIds: ['b1'] };
  await step('başlat', async () => {
    const t0 = performance.now();
    if (!A.net.start(payload)) throw new Error('start false');
    if (Bc.net.start(payload)) throw new Error('üye start yapabildi');
    await waitFor(() => [A, Bc, Cc, D].every(c => last(c, 'net:start')), 8000, 'herkes net:start');
    const ts = [A, Bc, Cc, D].map(c => last(c, 'net:start').t - t0);
    for (const c of [A, Bc, Cc, D]) { const d = last(c, 'net:start').d; if (JSON.stringify(d) !== JSON.stringify(payload)) throw new Error(c.name + ' payload farklı: ' + JSON.stringify(d)); }
    res.olc.baslat_ms = ts.map(Math.round); res.olc.baslat_kayma_ms = Math.round(Math.max(...ts) - Math.min(...ts));
    if ([A, Bc, Cc, D].some(c => count(c, 'net:start') !== 1)) throw new Error('net:start tekrarlandı');
    await waitFor(() => Cc.net.lobby().st === 'race', 4000, 'lobi st=race');
    ok('net:start herkese aynı yükle ulaştı (ev sahibi dahil, yankıyla) süreler ' + res.olc.baslat_ms.join('/') + ' ms, kayma ' + res.olc.baslat_kayma_ms + ' ms');
  });

  // ---- durum akışı ----
  const senders = [A, Bc, Cc, D];
  let streaming = true;
  const X0 = 100, VX = 300;
  const trueX = t => X0 + VX * (t / 1000);
  for (const c of senders) c.netRecv = {};
  for (const c of senders) {
    c.FM.on('net:event', d => { if (d.type === 'olcum') c.evLat.push(performance.now() - d.data.t0); });
  }
  // gelen her durum mesajının gerçek gecikmesi (tek süreç = ortak saat): sarmalayıcıyla ölç
  for (const c of senders) {
    const bufs = c.net._dbg.bufs;
    c.lastLen = {};
    c.measure = () => { for (const id in bufs) { const b = bufs[id]; const n = b.arr.length ? b.arr[b.arr.length - 1] : null; if (n && c.lastLen[id] !== n) { c.lastLen[id] = n; c.gotStates[id] = (c.gotStates[id] || 0) + 1; if (typeof n.d.st0 === 'number') c.lat.push(performance.now() - n.d.st0); } } };
  }
  const frame = () => {
    const t = performance.now();
    for (const c of senders) {
      if (c.paused) continue;
      const r = { x: trueX(t), y: 400, vx: VX, vy: 0, h: 42, face: 1, onGround: true, charge: 50, item: 'saw', shield: 1.234, tp: 0 };
      const s = c.net.packRacer(r, { st0: t });
      const bots = c === A && A.net.isHost() ? { b1: c.net.packRacer({ x: trueX(t) - 50, y: 380, vx: VX, vy: 0, h: 22, slide: true }, { st0: t }) } : null;
      c.net.sendState(s, bots);
    }
    for (const c of senders) c.measure();
  };
  const fiv = setInterval(() => { if (streaming) frame(); }, 16);
  const visLag = [], exN = { n: 0, ex: 0 };
  const siv = setInterval(() => {
    const t = performance.now();
    for (const c of [Cc, D]) { const s = c.net.sample(Bc.net.pid()); if (s && !s._stale) { visLag.push((trueX(t) - s.x) / VX * 1000); exN.n++; if (s._ex) exN.ex++; } }
  }, 33);
  await step('durum akışı', async () => {
    await sleep(3500);
    const rate = {};
    for (const c of senders) for (const o of senders) if (o !== c) rate[c.name + '<-' + o.name] = c.gotStates[o.net.pid()] || 0;
    const allLat = [].concat(...senders.map(c => c.lat));
    res.olc.durum_gecikme = stats(allLat);
    res.olc.durum_hiz_hz = Math.round(Object.values(rate).reduce((a, b) => a + b, 0) / Object.keys(rate).length / 3.5 * 10) / 10;
    res.olc.gorsel_gecikme = stats(visLag);
    res.olc.ongoru_orani = exN.n ? Math.round(exN.ex / exN.n * 100) + '%' : '-';
    const botN = (Cc.gotStates.b1 || 0);
    const smp = Cc.net.sample(Bc.net.pid());
    if (!smp || smp.it !== 'saw' || smp.sh !== 1.23 || smp.ch !== 50) throw new Error('örnek alanları: ' + JSON.stringify(smp));
    const r2 = Cc.net.applyRacer({ face: 1 }, smp);
    if (r2.item !== 'saw' || r2.onGround !== true || r2.shield !== 1.23 || r2.slide !== false || Math.abs(r2.x - smp.x) > 1e-6) throw new Error('applyRacer: ' + JSON.stringify(r2));
    const bs = Cc.net.sample('b1'); if (!bs || bs.sl !== 1 || bs.h !== 22) throw new Error('bot durumu: ' + JSON.stringify(bs));
    const beklenen = 1000 / A.net.BROKERS[bi].stMs;
    if (res.olc.durum_hiz_hz < beklenen * 0.75) throw new Error('durum hızı düşük: ' + res.olc.durum_hiz_hz + ' Hz (beklenen ~' + beklenen.toFixed(1) + ') ' + JSON.stringify(rate));
    if (botN < beklenen * 3.5 * 0.6) throw new Error('bot durumu az geldi: ' + botN);
    ok('durum akışı ~' + res.olc.durum_hiz_hz + ' Hz/oyuncu, gecikme ' + JSON.stringify(res.olc.durum_gecikme) + ' ms; ara değerlenmiş görsel gecikme ' + JSON.stringify(res.olc.gorsel_gecikme) + ' ms, öngörü ' + res.olc.ongoru_orani + '; bot b1 ' + botN + ' örnek');
  });

  await step('olaylar + emoji', async () => {
    for (let i = 0; i < 5; i++) { Bc.net.sendEvent('olcum', { t0: performance.now(), i }); await sleep(120); }
    Cc.net.emoji('😂');
    if (Cc.net.emoji('🔥')) throw new Error('emoji hız sınırı çalışmadı');
    await waitFor(() => [A, Cc, D].every(c => c.evLat.length === 5) && [A, Bc, D].every(c => last(c, 'net:emoji') && last(c, 'net:emoji').d.e === '😂'), 6000, 'olaylar herkese');
    if (Bc.evLat.length) throw new Error('kendi olayı kendine geldi');
    const me = last(Cc, 'net:emoji'); if (!me || !me.d.me) throw new Error('kendi emojisi yerelde bildirilmedi');
    const e = last(A, 'net:event'); if (e.d.from !== Bc.net.pid() || typeof e.d.lat !== 'number') throw new Error('olay yükü: ' + JSON.stringify(e.d));
    res.olc.olay_gecikme = stats([].concat(A.evLat, Cc.evLat, D.evLat));
    ok('olaylar (5×3) ve emoji ulaştı, olay gecikmesi ' + JSON.stringify(res.olc.olay_gecikme) + ' ms');
  });

  await step('yok oda / sürüm', async () => {
    const r1 = await noroomP; if (r1.code !== 'noroom') throw new Error('olmayan oda: ' + r1.code);
    const r2 = await verP; if (r2.code !== 'ver') throw new Error('sürüm: ' + r2.code);
    if (A.net.players().some(p => p.pid === V.net.pid())) throw new Error('sürümü farklı oyuncu odaya alındı');
    ok('olmayan oda "' + 'noroom' + '" (' + r1.ms + ' ms), sürüm uyuşmazlığı "ver" (' + r2.ms + ' ms)');
  });

  await step('yeniden bağlanma (üye)', async () => {
    const pidB = Bc.net.pid();
    const before = A.gotStates[pidB] || 0;
    const t0 = performance.now();
    Bc.net._dbg.kill();
    await waitFor(() => Bc.net.status().conn === 'reconnecting' || Bc.net.status().conn === 'connecting', 3000, 'B koptu');
    await waitFor(() => Bc.net.status().conn === 'open', 30000, 'B yeniden bağlandı');
    res.olc.yeniden_baglanma_ms = Math.round(performance.now() - t0);
    await waitFor(() => (A.gotStates[pidB] || 0) > before + 5, 6000, 'B durumları yeniden akıyor');
    if (!Bc.net.inRoom()) throw new Error('B odadan düştü');
    await sleep(2500);
    const pB = A.net.players().find(p => p.pid === pidB);
    if (!pB || pB.off || !pB.alive) throw new Error('B ev sahibinde düşmüş görünüyor: ' + JSON.stringify(pB));
    if (A.net.host() !== A.net.pid() || Bc.net.host() !== A.net.pid()) throw new Error('ev sahibi değişti');
    ok('üye koptu → ' + res.olc.yeniden_baglanma_ms + ' ms içinde geri geldi, odada kaldı, durum akışı sürdü');
  });

  await step('ev sahibi kısa kopma (göç olmamalı)', async () => {
    const t0 = performance.now();
    A.net._dbg.kill();
    await waitFor(() => A.net.status().conn === 'open', 30000, 'A yeniden bağlandı');
    const ms = Math.round(performance.now() - t0);
    await sleep(4000);
    if (count(Bc, 'net:host') || count(Cc, 'net:host')) throw new Error('gereksiz ev sahibi göçü');
    if (![A, Bc, Cc, D].every(c => c.net.host() === A.net.pid())) throw new Error('ev sahibi tutarsız');
    if (!A.net.isHost()) throw new Error('A ev sahipliğini kaybetti');
    ok('ev sahibi ' + ms + ' ms koptu ve döndü; göç olmadı');
  });

  let newHost = null;
  await step('ev sahibi düştü → göç', async () => {
    A.paused = true;
    const t0 = performance.now();
    A.net._dbg.freeze(true);
    const expect = [Bc, Cc, D].map(c => c.net.pid()).sort()[0];
    await waitFor(() => [Bc, Cc, D].every(c => c.net.host() === expect) && [Bc, Cc, D].filter(c => c.net.isHost()).length === 1, 15000, 'yeni ev sahibinde uzlaşma');
    res.olc.goc_ms = Math.round(performance.now() - t0);
    newHost = [Bc, Cc, D].find(c => c.net.isHost());
    await waitFor(() => [Bc, Cc, D].every(c => c.net.lobby().epoch === 1), 5000, 'dönem 1');
    const pa = newHost.net.players().find(p => p.pid === A.net.pid());
    if (!pa || !pa.off) throw new Error('eski ev sahibi yarışta "çevrimdışı" işaretlenmedi: ' + JSON.stringify(pa));
    const he = last(newHost, 'net:host'); if (!he || !he.d.me) throw new Error('yeni ev sahibine net:host {me:true} gelmedi');
    ok('ev sahibi sustu → ' + res.olc.goc_ms + ' ms sonra en küçük pid (' + newHost.name + ') ev sahibi oldu, herkes uzlaştı');
  });

  await step('eski ev sahibi geri döndü', async () => {
    if (!newHost) throw new Error('göç yok');
    const t0 = performance.now();
    A.net._dbg.freeze(false);
    A.paused = false;
    await waitFor(() => !A.net.isHost() && A.net.host() === newHost.net.pid(), 10000, 'A ev sahipliğini bırakır');
    await waitFor(() => { const p = newHost.net.players().find(q => q.pid === A.net.pid()); return p && !p.off; }, 10000, 'A tekrar çevrimiçi');
    res.olc.geri_donus_ms = Math.round(performance.now() - t0);
    await sleep(1500);
    if ([A, Bc, Cc, D].filter(c => c.net.isHost()).length !== 1) throw new Error('birden çok ev sahibi');
    ok('eski ev sahibi ' + res.olc.geri_donus_ms + ' ms içinde üyeye döndü ve yeniden katıldı');
  });

  await step('end / next / toLobby (yeni ev sahibi)', async () => {
    const h = newHost || A;
    const all = [A, Bc, Cc, D];
    const rk = { ranking: [Bc, Cc, A, D].map(c => c.net.pid()) };
    if (!h.net.end(rk)) throw new Error('end false');
    await waitFor(() => all.every(c => last(c, 'net:end') && JSON.stringify(last(c, 'net:end').d) === JSON.stringify(rk)), 8000, 'net:end herkese');
    if (!h.net.next({ seed: 7, round: 2 })) throw new Error('next false');
    await waitFor(() => all.every(c => last(c, 'net:next') && last(c, 'net:next').d.seed === 7), 8000, 'net:next herkese');
    if (!h.net.toLobby()) throw new Error('toLobby false');
    await waitFor(() => all.every(c => last(c, 'net:toLobby') && c.net.lobby().st === 'lobby'), 8000, 'net:toLobby herkese');
    if (all.some(c => count(c, 'net:end') !== 1 || count(c, 'net:toLobby') !== 1)) throw new Error('kontrol mesajı tekrarlandı');
    if (h.net.players().some(p => p.ready)) throw new Error('lobiye dönünce hazır bayrakları sıfırlanmadı');
    ok('end/next/toLobby herkese tam bir kez ulaştı');
  });
  streaming = false;

  const act = () => mine.filter(c => c.net.inRoom());
  await step('aynı pid ikinci oturum', async () => {
    const tgt = [Bc, Cc, D].find(c => c.net.inRoom() && !c.net.isHost());
    const T2 = mk(tgt.name + '_2', { store: tgt.store });
    if (T2.net.pid() !== tgt.net.pid()) throw new Error('pid paylaşılmadı');
    T2.net.joinRoom(code);
    await waitFor(() => T2.net.inRoom() && last(tgt, 'net:error') && last(tgt, 'net:error').d.code === 'dup', 12000, 'eski oturum çekilir');
    if (tgt.net.busy()) throw new Error('eski oturum hâlâ odada');
    await sleep(2500);
    const h = act().find(c => c.net.isHost()); if (!h) throw new Error('ev sahibi kayboldu');
    if (h.net.players().filter(p => p.pid === T2.net.pid()).length !== 1) throw new Error('çift kayıt');
    // ev sahibinin kimliğiyle ikinci sekme: ev sahibi etkilenmez, yeni sekme "dup" alır
    const H2 = mk('H2', { store: h.store });
    H2.net.joinRoom(code);
    await waitFor(() => last(H2, 'net:error'), 20000, 'ev sahibi kopyası reddi');
    if (last(H2, 'net:error').d.code !== 'dup') throw new Error('beklenen dup: ' + last(H2, 'net:error').d.code);
    if (!h.net.isHost() || !h.net.inRoom() || last(h, 'net:error') && last(h, 'net:error').t > performance.now() - 20000 && last(h, 'net:error').d.code === 'dup') throw new Error('ev sahibi etkilendi');
    ok('aynı kimlikle ikinci oturum: üyede eski oturum "dup" ile çekildi; ev sahibi kopyası reddedildi, ev sahibi etkilenmedi');
  });

  await step('atma', async () => {
    const h = act().find(c => c.net.isHost());
    const victim = act().find(c => c !== h);
    if (!h.net.kick(victim.net.pid())) throw new Error('kick false');
    await waitFor(() => last(victim, 'net:kicked') && !victim.net.busy(), 6000, 'atılan bildirim alır');
    await waitFor(() => !h.net.players().some(p => p.pid === victim.net.pid()), 3000, 'listeden çıkar');
    victim.net.joinRoom(code);
    await waitFor(() => last(victim, 'net:error') && last(victim, 'net:error').d.code === 'kicked', 25000, 'atılan geri giremez');
    ok('atılan oyuncu bildirildi, listeden çıktı, tekrar giremedi');
  });

  await step('dolu oda (10)', async () => {
    const h = mine.find(c => c.net.isHost());
    const need = 10 - h.net.players().length;
    const fill = []; for (let i = 0; i < need; i++) fill.push(mk('F' + i));
    for (const f of fill) f.net.joinRoom(code);
    await waitFor(() => fill.every(f => f.net.inRoom()), 60000, 'doldurucular katıldı');
    await waitFor(() => h.net.players().length === 10, 5000, '10 oyuncu');
    const G = mk('G'); G.net.joinRoom(code);
    await waitFor(() => last(G, 'net:error'), 40000, '11. oyuncu hatası');
    if (last(G, 'net:error').d.code !== 'full') throw new Error('beklenen full, gelen ' + last(G, 'net:error').d.code);
    if (h.net.players().length !== 10) throw new Error('oyuncu sayısı ' + h.net.players().length);
    ok('10 oyuncu doldu, 11. "' + last(G, 'net:error').d.msg + '"');
  });

  await step('oda kapanınca retain temizlenir', async () => {
    const h = mine.find(c => c.net.isHost());
    for (const c of mine) if (c !== h && c.net.busy()) c.net.leaveRoom();
    await waitFor(() => h.net.players().length === 1, 10000, 'ev sahibi yalnız kaldı');
    h.net.leaveRoom();
    await sleep(800);
    const Z = mk('Z');
    const t0 = performance.now();
    Z.net.joinRoom(code);
    let sawR = false; const pv = setInterval(() => { if (Z.net._dbg.R.sawRetained) sawR = true; }, 30);
    await waitFor(() => last(Z, 'net:error'), 60000, 'kapalı oda hatası');
    clearInterval(pv);
    if (last(Z, 'net:error').d.code !== 'noroom') throw new Error('beklenen noroom: ' + last(Z, 'net:error').d.code);
    if (sawR) throw new Error('retain lobi temizlenmemiş');
    ok('herkes ayrıldı; kapalı odaya katılma "noroom" (' + Math.round(performance.now() - t0) + ' ms), retain temiz');
  });

  clearInterval(fiv); clearInterval(siv);
  // yakalanmış istisna var mı?
  for (const c of mine) { const h = c.net.log().filter(l => l.indexOf('HATA') >= 0); if (h.length) bad(c.name + ' net.js içinde yakalanan hata: ' + h.slice(0, 3).join(' | ')); }
  for (const c of mine) { try { c.net.leaveRoom(); } catch (e) { } }
  return res;
}

// Çevrimdışı: MQTT çerçeve ayrıştırıcısı — parçalı/birleşik WebSocket mesajları, 1-2-3 baytlık uzunluk, UTF-8, bozuk çerçeve
function frameTest() {
  const c = client('çerçeve'), D = c.net._dbg;
  const got = []; let opened = 0, closed = null;
  const m = new D.Mq('wss://yok', { onOpen: () => opened++, onClose: r => { closed = r; }, onMsg: (t, p, r) => got.push({ t, p: D.fromUtf8(p), r }) });
  const pubPkt = (topic, text, retain) => D.packet(0x30 | (retain ? 1 : 0), [D.mqStr(D.utf8(topic)), D.utf8(text)]);
  const texts = ['kısa', 'Çağrı ğüşıöç İĞÜŞÖÇ 😂 ' + 'ş'.repeat(80), 'x'.repeat(20000) + 'ğ'];   // 1, 2, 3 baytlık kalan uzunluk
  const parts = [D.packet(0x20, [new Uint8Array([0, 0])])];
  texts.forEach((t, i) => parts.push(pubPkt('fuatmorel/v1/TEST/ev' + i, t, i === 1)));
  parts.push(new Uint8Array([0xD0, 0]));                                        // PINGRESP
  let all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  // rastgele parçala (1 bayttan başlayarak), her parçayı ayrı WS mesajı gibi ver
  let pos = 0, nChunks = 0; const rnd = (() => { let s = 7; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  while (pos < all.length) { const n = nChunks < 3 ? 1 : 1 + Math.floor(rnd() * 3000); const ch = all.slice(pos, pos + n); m.feed(ch.buffer); pos += n; nChunks++; }
  const okAll = opened === 1 && got.length === 3 && got.every((g, i) => g.p === texts[i] && g.t === 'fuatmorel/v1/TEST/ev' + i) && got[1].r === true && got[0].r === false && closed === null;
  // birleşik: üç paket tek WS mesajında
  got.length = 0; const two = new Uint8Array(parts[1].length * 3); two.set(parts[1], 0); two.set(parts[1], parts[1].length); two.set(parts[1], parts[1].length * 2); m.feed(two.buffer);
  const okJoin = got.length === 3;
  // bozuk: 5 devam baytı
  m.feed(new Uint8Array([0x30, 0xff, 0xff, 0xff, 0xff, 0x01]).buffer);
  const okBad = closed && closed.indexOf('bozuk') >= 0;
  console.log((okAll && okJoin && okBad ? '  ✓' : '  ✗') + ' çerçeve ayrıştırıcı: ' + nChunks + ' parçaya bölünmüş akış (1/2/3 baytlık uzunluk, Türkçe+emoji UTF-8, retain bayrağı) doğru birleşti; tek mesajda 3 paket ayrıldı; bozuk uzunlukta bağlantı kapandı');
  return okAll && okJoin && okBad ? 0 : 1;
}

(async () => {
  const arg = process.argv[2] || (BURL ? 'yerel' : 'all');
  let broker = null;
  if (arg === 'yerel' && !BURL) { broker = await require('./broker.js').start({ port: 0, delay: +(process.env.NET_DELAY || 0) }); BURL = broker.url; console.log('Yerel aracı: ' + BURL); }
  const list = arg === 'yerel' ? [1] : arg === 'all' ? [0, 1, 2] : arg === 'cerceve' ? [] : [+arg];
  const out = [];
  console.log('=== Çevrimdışı ===');
  const frameFail = frameTest();
  if (frameFail) out.push({ broker: 'çerçeve', ok: [], fail: ['çerçeve ayrıştırıcı'], olc: {} });
  for (const bi of list) { out.push(await runBroker(bi)); await sleep(1500); }
  console.log('\n=== ÖZET ===');
  let fails = 0;
  for (const r of out) { fails += r.fail.length; console.log(r.broker + ': ' + r.ok.length + ' geçti, ' + r.fail.length + ' kaldı ' + JSON.stringify(r.olc)); for (const f of r.fail) console.log('   ✗ ' + f); }
  const outFile = process.env.NET_TEST_OUT;
  if (outFile) try { fs.writeFileSync(outFile, JSON.stringify(out, null, 1)); } catch (e) { }
  await sleep(500);
  if (broker) await broker.close();
  process.exit(fails ? 1 : 0);
})();
