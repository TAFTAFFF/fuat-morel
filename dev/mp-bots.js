// Kullanım:
//   node dev/mp-bots.js host [oyuncu=4] [mod=classic] [tema=random] [tur=1] [doldur=4] [aracı] [--hostdrop=SN] [--drop=SN] [--late=SN]
//       → node'da N "hayalet" oyuncu; ilki odayı kurar, hepsi katılınca maçı başlatır, maç bitene kadar oynar, sonra
//         tüm istemcilerde tur sonuçlarının (sıralama + puan) AYNI olduğunu, uzak yarışçıların hareket ettiğini, olayların
//         karşıya geçtiğini ve konsol hatası olmadığını denetler.
//   node dev/mp-bots.js join KOD [oyuncu=3] [sn=240]
//   node dev/mp-bots.js lobi [--yerel]
//       → TUR5 lobi akışı: herkes HAZIR → 5 sn geri sayım (mp:countdown herkeste) → yarış; hazırı geri alma iptali; turlar arası
//         otomatik geçiş + üyede autoLeft(); final sonrası herkes LOBİYE (aynı oda); yarış ortasında yenileyen üyenin aynı yarışçıya dönmesi.
//   node dev/mp-bots.js p2p [--yerel]
//       → TUR6 doğrudan bağlantı ağı (sahte WebRTC, dev/net-rtcfake.js): 4 oyuncu tam örgü (6 bağlantı, sıralı kurulum), herkes doğrudanken
//         aracı durumu ~1 Hz'e iner, sonra WebRTC'siz bir oyuncu gelince herkes aracıyı normal hızda kullanır; sonuçlar herkeste aynı,
//         her olay her alıcıda TAM BİR KEZ (iki yoldan gelen tekrar atılır), konsol hatası yok.
//   --yerel: dev/broker.js ile bu süreçte yerel aracı başlatır (ya da NET_BROKER=ws://.../mqtt). Herkese açık aracıya ulaşılamayan ortamlar için.
//       → var olan odaya (ör. tarayıcıdaki oyun) N hayalet katılır ve otomatik pilotla oynar (ev sahibi lobiye dönünce / süre dolunca biter).
// Her hayalet GERÇEK istemcidir: core+gfx+net+level+game+meta+netgame (çizim yok) ayrı bir vm bağlamında, kendi pid'i ve kaydıyla;
// yerel yarışçısını oyunun yapay zekâsı sürer (FM.netgame.autopilot). Aracıya gerçek WebSocket ile bağlanır (Node 24 global WebSocket).
// Hafif: tek node süreci, 30 Hz döngü, düşük öncelik.
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
const FILES = ['core', 'gfx', 'net', 'level', 'game', 'meta', 'netgame'];
const SRC = FILES.map(f => [f, fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8')]);
const CHARS = ['TAFTAF', 'Caner', 'LUL', 'ertan', 'Kral', 'Nuss', 'baso'];
let BURL = process.env.NET_BROKER || null;      // yerel/özel aracı: tüm hayaletler ?brokerUrl= ile buna bağlanır
function setBroker(u) { BURL = u || null; }

function stubEl() {
  return { style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } }, addEventListener() { }, removeEventListener() { }, appendChild() { }, remove() { },
    setAttribute() { }, querySelector() { return null; }, querySelectorAll() { return []; }, dataset: {},
    getContext() { return new Proxy({}, { get: (t, p) => p in t ? t[p] : (() => ({ addColorStop() { } })), set: (t, p, v) => (t[p] = v, true) }); } };
}

/* Bir hayalet istemci oluştur. opts: {nick, char, quiet} */
function ghost(nick, opts) {
  opts = opts || {};
  const store = opts.store || {};
  const ch = opts.char || CHARS[(Math.random() * CHARS.length) | 0];
  if (!store.fuatmorel_save_v2) store.fuatmorel_save_v2 = JSON.stringify({ selChar: ch, nick, nickSet: true });
  const g = { nick, errors: [], ev: [], timers: [], stopped: false };
  const cons = {
    log: (...a) => { if (!opts.quiet) console.log('[' + nick + ']', ...a); },
    info: (...a) => { if (!opts.quiet) console.log('[' + nick + ']', ...a); },
    warn: (...a) => { console.log('[' + nick + '] UYARI', ...a); },
    error: (...a) => { const s = a.map(x => (x && x.stack) || String(x)).join(' '); g.errors.push(s); console.log('[' + nick + '] HATA', s.slice(0, 600)); }
  };
  const sb = { console: cons, Math, Date, JSON,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); return t; }, clearTimeout,
    setInterval: (f, ms) => { const t = setInterval(f, ms); g.timers.push(t); return t; }, clearInterval,
    performance, crypto: globalThis.crypto, TextEncoder, TextDecoder, WebSocket, URL, URLSearchParams,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search: BURL ? '?brokerUrl=' + encodeURIComponent(BURL) : '', href: 'https://ornek.github.io/fuat-morel/index.html' }, navigator: { maxTouchPoints: 0, onLine: true }, history: { replaceState() { } },
    matchMedia: () => ({ matches: false, addEventListener() { } }), innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    addEventListener() { }, removeEventListener() { }, requestAnimationFrame() { return 0; },
    document: { hidden: false, getElementById: () => stubEl(), createElement: () => stubEl(), querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener() { }, body: stubEl(), fonts: null } };
  // opts.rtc: sahte WebRTC (dev/net-rtcfake.js; aynı süreçteki hayaletler arasında doğrudan bağlantı), {fail: true} → bağlantısı açılmaz
  if (opts.rtc) sb.RTCPeerConnection = require('./net-rtcfake.js').makeRTC(opts.rtc.net || null, { fail: !!opts.rtc.fail });
  sb.window = sb; vm.createContext(sb);
  for (const [f, s] of SRC) vm.runInContext(s, sb, { filename: f + '.js' });
  const FM = sb.FM;
  FM.view.VW = 1100;
  FM.netgame.autopilot = true;
  g.FM = FM; g.net = FM.net; g.ng = FM.netgame;
  g.store = store;
  for (const e of ['mp:start', 'mp:end', 'mp:final', 'mp:lobby', 'mp:host', 'mp:drop', 'mp:back', 'mp:left', 'mp:waiting', 'net:error', 'net:kicked', 'mp:emote', 'mp:countdown', 'mp:rejoining'])
    FM.on(e, d => { g.ev.push({ e, t: Date.now(), d: e === 'mp:end' || e === 'mp:final' || e === 'mp:countdown' || e === 'mp:start' || e === 'mp:left' ? JSON.parse(JSON.stringify(d, (k, v) => (k === 'r' && v && typeof v === 'object' ? undefined : v))) : (d && (d.code || d.pid || d.round || d.reason)) || null }); });
  // oyun döngüsü (main.js yerine): sabit adım + parçacık/bildirim sönümü
  const STEP = FM.C.STEP, S = FM.S;
  let last = performance.now(), acc = 0;
  g.loop = setInterval(() => {
    try {
      const t = performance.now(); let dt = (t - last) / 1000; last = t; if (dt > .1) dt = .1;
      acc += dt; let n = 0;
      while (acc >= STEP && n < 14) { FM.game.step(STEP); acc -= STEP; n++; }
      if (n >= 14) acc = 0;
      for (const x of S.toasts) x.t -= dt; S.toasts = S.toasts.filter(x => x.t > 0);
      for (const x of S.feed) x.t -= dt; S.feed = S.feed.filter(x => x.t > 0);
      for (const p of S.parts) p.life -= dt; S.parts = S.parts.filter(p => p.life > 0);
      for (const r of S.rings) r.life -= dt; S.rings = S.rings.filter(r => r.life > 0);
      if (S.mode === 'podium') S.podiumT = (S.podiumT || 0) + dt;
    } catch (e) { cons.error(e); }
  }, 33);
  g.stop = () => {
    if (g.stopped) return; g.stopped = true;
    clearInterval(g.loop); for (const t of g.timers) clearInterval(t);
    try { FM.net.leaveRoom(); } catch (e) { }
  };
  g.last = e => { for (let i = g.ev.length - 1; i >= 0; i--) if (g.ev[i].e === e) return g.ev[i]; return null; };
  g.count = e => g.ev.filter(x => x.e === e).length;
  return g;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { let ok = false; try { ok = await fn(); } catch (e) { } if (ok) return Date.now() - t0; if (Date.now() - t0 > ms) throw new Error('zaman aşımı: ' + what); await sleep(150); }
}
// sonuçlar aynı mı? (sıra + puan + toplam)
function endSig(d) { return d && Array.isArray(d.ranking) ? d.ranking.map(e => e.pid + ':' + e.rp + ':' + e.total).join(',') : 'yok'; }

module.exports = { ghost, sleep, waitFor, endSig, CHARS, setBroker };

/* =================== komut satırı =================== */
if (require.main === module) {
  // bayraklar: --hostdrop=SN (ev sahibi SN. saniyede donar/kopar → göç), --drop=SN (Oyuncu1 kopar → "bağlantı koptu", sonuçta en sonda),
  //           --late=SN (SN. saniyede bir oyuncu daha katılır → izleyici, sonraki turda yarışır)
  const FL = {}; const A = process.argv.slice(2).filter(a => { const m = /^--([a-z]+)(?:=(.*))?$/.exec(a); if (m) { FL[m[1]] = m[2] == null ? '1' : m[2]; return false; } return true; });
  const cmd = A[0] || 'host';
  (async () => {
    const all = [];
    let broker = null;
    if (FL.yerel && !BURL) { broker = await require('./broker.js').start({ port: 0, delay: +(FL.gecikme || 0) }); setBroker(broker.url); console.log('Yerel aracı: ' + broker.url); }
    const finish = code => { for (const g of all) g.stop(); setTimeout(() => { if (broker) broker.close(); process.exit(code); }, 400); };
    process.on('SIGINT', () => finish(130));
    try {
      if (cmd === 'join') {
        const code = A[1], n = Math.max(1, Math.min(9, +(A[2] || 3))), sec = +(A[3] || 240);
        if (!code) { console.log('oda kodu gerekli'); return finish(2); }
        for (let i = 0; i < n; i++) { const g = ghost('Hayalet' + (i + 1), { quiet: true }); all.push(g); g.net.joinRoom(code); await sleep(250); }
        await waitFor(() => all.every(g => g.net.inRoom()), 30000, 'hayaletler odaya katıldı');
        console.log(n + ' hayalet odada: ' + code);
        const t0 = Date.now();
        let lastLog = 0;
        while (Date.now() - t0 < sec * 1000) {
          await sleep(1000);
          if (Date.now() - lastLog > 10000) {
            lastLog = Date.now();
            const d = all[0].ng.debug();
            console.log(`  ${Math.round((Date.now() - t0) / 1000)} sn: faz ${d.M.phase} tur ${d.M.round}/${d.M.rounds} mod ${d.mode} — ` + d.racers.map(r => `${r.name}${r.ctrl === 'local' ? '*' : ''}@${r.x}${r.fin ? '✓' : ''}${r.off ? '(koptu)' : ''}`).join(' '));
          }
          if (all.every(g => g.count('mp:lobby') >= 2 || g.count('mp:left') > 0)) break;
        }
        const errs = all.reduce((a, g) => a + g.errors.length, 0);
        for (const g of all) console.log(`  ${g.nick}: tur sonu ${g.count('mp:end')}, final ${g.count('mp:final')}, hata ${g.errors.length}, olay gönder ${JSON.stringify(g.ng.debug().stats.sent)}`);
        console.log(errs ? 'HATA VAR' : 'TAMAM');
        return finish(errs ? 1 : 0);
      }
      if (cmd === 'lobi') { const bad = await lobbyFlow(all); return finish(bad ? 1 : 0); }
      if (cmd === 'p2p') { const bad = await p2pFlow(all); return finish(bad ? 1 : 0); }
      // --- host: tamamen node içinde maç ---
      const n = Math.max(2, Math.min(10, +(A[1] || 4))), mode = A[2] || 'classic', theme = A[3] || 'random', rounds = +(A[4] || 1), fill = +(A[5] || 4);
      const broker = A[6] != null ? +A[6] : undefined;
      const t00 = Date.now();
      const H = ghost('Ev', { char: 'Kral', quiet: true }); all.push(H);
      H.net.createRoom({ cfg: { mode, map: theme, rounds, bots: true, fill, autoNext: 5 }, broker });
      await waitFor(() => H.net.inRoom(), 30000, 'oda kuruldu');
      const code = H.net.code();
      console.log(`oda ${code} (${H.net.status().brokerName}) — ${n} oyuncu, mod ${mode}, tema ${theme}, ${rounds} tur, bot doldurma ${fill}`);
      for (let i = 1; i < n; i++) { const g = ghost('Oyuncu' + i, { quiet: true }); all.push(g); g.net.joinRoom(code); await sleep(300); }
      await waitFor(() => all.every(g => g.net.inRoom()) && H.net.players().length === n, 40000, 'herkes katıldı');
      console.log(`herkes odada (${((Date.now() - t00) / 1000).toFixed(1)} sn)`);
      // her tur başından 4 sn sonra: seviye saatleri herkeste aynı mı (önceki turun bayat örnekleri saati kaydırmasın)
      const roundLt = {};
      all[all.length - 1].FM.on('mp:start', d => setTimeout(() => {
        const v = all.filter(g => !g.dropped && g.ng.state().phase === 'race' && g.ng.state().round === d.round).map(g => g.ng.debug().lt);
        if (v.length > 1) roundLt[d.round] = Math.round((Math.max(...v) - Math.min(...v)) * 1000);
      }, 4000));
      if (!H.ng.hostStart()) throw new Error('hostStart başarısız');
      await waitFor(() => all.every(g => g.count('mp:start') >= 1), 10000, 'herkese start');
      const ok = [], bad = [];
      const pass = m => { ok.push(m); console.log('  ✓ ' + m); }, fail = m => { bad.push(m); console.log('  ✗ ' + m); };
      const live = () => all.filter(g => !g.dropped);
      pass('start herkese ulaştı; harita: ' + all.map(g => g.FM.S.L.theme.id + '/' + Math.round(g.FM.S.L.end)).filter((v, i, a) => a.indexOf(v) === i).join(', '));
      const tStart = Date.now();
      // senaryolar: geç katılan oyuncu, ev sahibinin donup kopması (göç)
      if (FL.late) setTimeout(() => {
        const g = ghost('GecGelen', { quiet: true }); all.push(g); g.late = true; g.net.joinRoom(code);
        console.log(`    (${((Date.now() - tStart) / 1000).toFixed(0)}. sn) GecGelen odaya katılıyor`);
        // 5 sn sonra: geç katılanın seviye saati ve izlediği yarış ev sahibininkiyle aynı mı
        setTimeout(() => {
          const a = g.ng.debug(), h = live().find(x => x.net.isHost()) || H, b = h.ng.debug();
          const msg = `geç katılan: faz ${a.M.phase}, izleyici ${a.M.spectating}, mod ${a.mode}, seviye saati ${a.lt} (ev sahibi ${b.lt}), yarış saati ${a.raceT} (ev sahibi ${b.raceT}), izlenen ${a.player && a.player.ghost ? 'hayalet→' + a.player.x : '-'}`;
          if (a.M.spectating && Math.abs(a.lt - b.lt) < .4 && a.mode === b.mode) pass(msg); else fail(msg);
        }, 5000);
      }, +FL.late * 1000);
      if (FL.hostdrop) setTimeout(() => {
        H.dropped = true; clearInterval(H.loop); H.net._dbg.freeze(true);
        console.log(`    (${((Date.now() - tStart) / 1000).toFixed(0)}. sn) ev sahibi DONDU (telefon kapandı benzetimi)`);
      }, +FL.hostdrop * 1000);
      if (FL.drop) setTimeout(() => {
        const g = all.find(x => x.nick === 'Oyuncu1'); if (!g) return;
        // gerçek kopma: donar ve bir daha bağlanmaz (aracı keepalive dolunca Last Will yayınlar)
        g.dropped = true; clearInterval(g.loop); g.net._dbg.C.want = false; g.net._dbg.freeze(true);
        console.log(`    (${((Date.now() - tStart) / 1000).toFixed(0)}. sn) Oyuncu1 DONDU (bağlantısı koptu, geri gelmeyecek)`);
      }, +FL.drop * 1000);
      // emoji: bir oyuncunun emojisi diğerlerinde onun yarışçısına düşüyor mu
      await sleep(6000);
      const E = all[all.length - 1];
      E.net.emoji('😂');
      await sleep(1500);
      const emo = all.filter(g => g !== E && !g.dropped).map(g => { const r = g.ng.racer(E.net.pid()); return r && r.emote ? r.emote.id : null; });
      if (emo.length && emo.every(x => x === '😂')) pass(`emoji herkeste ${E.nick} yarışçısının üstünde (r.emote)`); else fail('emoji: ' + JSON.stringify(emo));
      // yarış ortası: herkes diğerlerini hareket ederken görüyor mu, saatler aynı mı
      await sleep(4500);
      const L0 = live().filter(g => !g.late);
      const snap = L0.map(g => g.ng.debug());
      let moving = 0, total = 0;
      for (let i = 0; i < L0.length; i++) {
        for (const r of snap[i].racers) {
          if (r.ctrl !== 'remote') continue;
          total++;
          const own = snap.find(dd => dd.racers.some(q => q.pid === r.pid && (q.ctrl === 'local' || q.ctrl === 'bot')));
          const real = own && own.racers.find(q => q.pid === r.pid);
          if ((r.x > 400 || r.fin || r.out) && real && Math.abs(real.x - r.x) < 420) moving++;
          else console.log(`    ${L0[i].nick}: ${r.name} uzak x=${r.x}, gerçek x=${real ? real.x : '?'}`);
        }
      }
      if (total && moving >= total * .85) pass(`uzak yarışçılar hareket ediyor ve gerçek konuma yakın (${moving}/${total})`); else fail(`uzak yarışçılar: ${moving}/${total}`);
      const lts = snap.map(d => d.lt);
      const spread = Math.max(...lts) - Math.min(...lts);
      if (spread < .35) pass(`seviye saatleri eşit (fark ${(spread * 1000).toFixed(0)} ms)`); else fail('seviye saati farkı ' + spread.toFixed(2) + ' sn: ' + lts.join(' '));
      // maç sonu
      const until = Date.now() + rounds * 200000;
      await waitFor(() => live().every(g => g.count('mp:final') >= 1 || g.count('mp:lobby') >= 2) || Date.now() > until, rounds * 200000 + 5000, 'maç sonu');
      if (FL.hostdrop) {
        const hs = live().map(g => g.ev.filter(x => x.e === 'mp:host').length);
        const nh = live().filter(g => g.net.isHost()).map(g => g.nick);
        if (nh.length === 1) pass(`ev sahibi göçü: yeni ev sahibi ${nh[0]} (mp:host olayları ${hs.join('/')}), botlar devralındı`); else fail('göç: ev sahibi sayısı ' + nh.length);
      }
      if (FL.late) {
        const gl = all.find(g => g.late);
        const w = gl && gl.ev.find(x => x.e === 'mp:waiting');
        if (w) pass(`geç katılan izleyici olarak bekledi (mp:waiting), sonra ${gl.ev.filter(x => x.e === 'mp:start').length} start aldı`); else fail('geç katılan mp:waiting almadı');
      }
      const L1 = live();
      for (let rd = 1; rd <= rounds; rd++) {
        const sigs = L1.map(g => { const e = g.ev.filter(x => x.e === 'mp:end').map(x => x.d).find(d => d.round === rd); return endSig(e); });
        const ref = L1[0].ev.filter(x => x.e === 'mp:end').map(x => x.d).find(d => d.round === rd);
        if (sigs.every(s => s === sigs[0] && s !== 'yok')) pass(`tur ${rd}: sonuç herkeste aynı: ${ref.ranking.map(e => e.nick + (e.finished ? '' : e.off ? '(koptu)' : e.out ? '(elendi)' : '(—)') + ' +' + e.rp).join(', ')}`);
        else fail(`tur ${rd}: sonuçlar farklı:\n      ` + L1.map((g, i) => g.nick + ': ' + sigs[i]).join('\n      '));
      }
      // akıl sağlığı: hiçbir tur 15 sn'den kısa sürede bitirilemez (bayat "bitirdi" bayrağı olmasın); tur başı saat farkı küçük
      const quick = [];
      for (const x of L1[0].ev.filter(x => x.e === 'mp:end')) for (const e of x.d.ranking) if (e.finished && e.ftime < 15) quick.push(`tur ${x.d.round} ${e.nick} ${e.ftime}`);
      if (!quick.length) pass('bitiş süreleri makul (bayat bitiş yok)'); else fail('çok erken bitiş: ' + quick.join(', '));
      const rlts = Object.keys(roundLt).map(k => `tur ${k}: ${roundLt[k]} ms`);
      if (Object.values(roundLt).every(v => v < 350)) pass('tur başında seviye saatleri eşit (' + rlts.join(', ') + ')'); else fail('tur başı saat farkı: ' + rlts.join(', '));
      const fin = L1.map(g => { const f = g.last('mp:final'); return f ? f.d.standings.map(s => s.pid + ':' + s.total).join(',') : 'yok'; });
      if (fin.every(s => s === fin[0] && s !== 'yok')) pass('final sıralaması herkeste aynı: ' + L1[0].last('mp:final').d.standings.map(s => s.nick + ' ' + s.total).join(', '));
      else fail('final farklı: ' + fin.join(' | '));
      // olaylar karşıya geçti mi
      const sent = {}, recv = {};
      for (const g of all) { const st = g.ng.debug().stats; for (const k in st.sent) sent[k] = (sent[k] || 0) + st.sent[k]; for (const k in st.recv) recv[k] = (recv[k] || 0) + st.recv[k]; }
      console.log('    gönderilen olaylar: ' + JSON.stringify(sent));
      console.log('    alınan olaylar:     ' + JSON.stringify(recv));
      if ((recv.it || 0) > 0 && (recv.fn || 0) > 0) pass('eşya/ölüm/bitiş olayları karşıya geçti'); else fail('olaylar eksik');
      // lobiye dönüş (otomatik, ev sahibi)
      await waitFor(() => live().every(g => g.count('mp:lobby') >= 2), 45000, 'lobiye dönüş').then(() => pass('ev sahibi otomatik lobiye döndü, herkes lobide')).catch(e => fail(e.message));
      const errs = all.reduce((a, g) => a + g.errors.length, 0);
      if (!errs) pass('konsol hatası yok'); else fail(errs + ' konsol hatası');
      console.log(`\nSonuç: ${ok.length} geçti, ${bad.length} kaldı (${((Date.now() - t00) / 1000).toFixed(0)} sn)`);
      finish(bad.length ? 1 : 0);
    } catch (e) { console.log('HATA', e.stack || e); finish(1); }
  })();
}

/* =================== TUR5 lobi akışı (node dev/mp-bots.js lobi --yerel) ===================
   herkes hazır → 5 sn geri sayım (her istemcide mp:countdown 5..1) → yarış; yeni gelen / çıkan / hazırı geri alan iptal eder;
   yarış ortasında sayfası yenilenen üye aynı yarışçıya kaldığı yerden döner; turlar arası otomatik geçiş (üyede de autoLeft);
   final → ~10 sn sonra herkes aynı odada LOBİDE (hazırlar sıfır); ev sahibinin yenilemesi; tek başına ev sahibinin odayı geri alması;
   olmayan odaya geri dönüş denemesi → mp:left {reason: 'rejoin-failed'}. */
async function lobbyFlow(all) {
  let bad = 0; const t00 = Date.now();
  const pass = m => console.log('  ✓ ' + m), fail = m => { bad++; console.log('  ✗ ' + m); };
  const el = () => ((Date.now() - t00) / 1000).toFixed(1) + ' sn';
  const cds = g => g.ev.filter(x => x.e === 'mp:countdown').map(x => x.d);
  const mk = (n, o) => { const g = ghost(n, Object.assign({ quiet: true }, o || {})); all.push(g); return g; };
  // sayfa yenileme / uygulama kapanması benzetimi: pagehide (bilerek çıkış DEĞİL) + istemci durur, kayıt (store) kalır
  const refresh = g => { g.net._dbg.pagehide(); g.stopped = true; clearInterval(g.loop); for (const t of g.timers) clearInterval(t); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { fail(name + ' — ' + (e && e.message)); } };
  const H = mk('Ev', { char: 'Kral' }), Am = mk('Ayşe'), Bm = mk('Barış');
  for (const g of all) g.ng.autopilot = true;
  if (H.ng.normCfg({ autoNext: 20 }).autoNext !== 10 || H.ng.normCfg({}).autoNext !== 8) fail('autoNext sınırı: ' + JSON.stringify(H.ng.normCfg({ autoNext: 20 })));
  H.net.createRoom({ cfg: { mode: 'classic', map: 'random', rounds: 2, bots: true, fill: 4 } });
  await waitFor(() => H.net.inRoom(), 20000, 'oda kuruldu');
  const code = H.net.code();
  console.log(`oda ${code} (${H.net.status().brokerName})`);
  Am.net.joinRoom(code); Bm.net.joinRoom(code);
  await waitFor(() => [Am, Bm].every(g => g.net.inRoom()) && H.net.players().length === 3, 20000, 'üyeler katıldı');

  // yeni kozmetik türleri (şapka / zafer kutlaması / ölüm efekti) ağdan taşınır
  Am.net.setProfile({ hat: 'parti', win: 'konfeti', death: 'hayalet' });
  await waitFor(() => { const p = H.net.players().find(q => q.pid === Am.net.pid()); return p && p.hat === 'parti' && p.win === 'konfeti' && p.death === 'hayalet'; }, 5000, 'kozmetik lobide');
  await step('geri sayım + iptaller', async () => {
    H.net.setReady(true); Am.net.setReady(true);
    await sleep(1500);
    if (H.ng.countdown() != null) throw new Error('herkes hazır değilken geri sayım başladı');
    Bm.net.setReady(true);
    await waitFor(() => [H, Am, Bm].every(g => g.ng.countdown() === 5 || g.ng.countdown() === 4), 3000, 'geri sayım herkeste');
    pass('herkes hazır (ev sahibi dahil) → 5 sn geri sayım herkeste başladı (' + [H, Am, Bm].map(g => g.ng.countdown()).join('/') + ')');
    // yeni biri girer → iptal (join)
    const J = mk('Geç');
    J.net.joinRoom(code);
    await waitFor(() => [H, Am, Bm].every(g => { const c = cds(g); return c.length && c[c.length - 1].left === null && c[c.length - 1].reason === 'join'; }), 8000, 'katılınca iptal');
    pass('yeni oyuncu girince geri sayım herkeste iptal (reason: join)');
    J.net.setReady(true);
    await waitFor(() => H.ng.countdown() != null && Am.ng.countdown() != null, 5000, 'yeni gelen hazır → yeniden sayım');
    J.stop();                                                   // bilerek çıkış → iptal (leave)
    await waitFor(() => [H, Am, Bm].every(g => cds(g).some(c => c.left === null && c.reason === 'leave')), 9000, 'çıkınca iptal');
    pass('hazır oyuncu çıkınca iptal (reason: leave), kalanlar hazır olduğu için sayım kısa beklemeyle yeniden başlıyor');
    await waitFor(() => Am.ng.countdown() != null, 5000, 'yeniden sayım');
    Am.net.setReady(false);
    await waitFor(() => [H, Am, Bm].every(g => { const c = cds(g); return c.length && c[c.length - 1].left === null && c[c.length - 1].reason === 'unready'; }), 5000, 'hazırı geri alınca iptal');
    await sleep(6000);
    if ([H, Am, Bm].some(g => g.ng.state().phase !== 'lobby')) throw new Error('iptalden sonra yarış başladı');
    pass('hazırı geri alınca iptal (reason: unready); yarış başlamadı');
    for (const g of [H, Am, Bm]) g.ev = g.ev.filter(x => x.e !== 'mp:countdown');
    Am.net.setReady(true);
    const t0 = Date.now();
    await waitFor(() => [H, Am, Bm].every(g => g.count('mp:start') >= 1), 12000, 'sayım sonunda yarış');
    const dt = (Date.now() - t0) / 1000;
    const seqB = cds(Bm).map(c => c.left === null ? 'x(' + c.reason + ')' : c.left).join(',');
    const ra = H.ng.racer(Am.net.pid()), rb = Bm.ng.racer(Am.net.pid());
    if (ra && rb && ra.hat === 'parti' && ra.win === 'konfeti' && ra.death === 'hayalet' && rb.hat === 'parti') pass('şapka/zafer/ölüm kozmetiği lobi listesine ve diğer telefonlardaki yarışçıya taşındı (r.hat/r.win/r.death)');
    else fail('kozmetik: ' + JSON.stringify(ra && { hat: ra.hat, win: ra.win, death: ra.death }));
    if (dt > 4.3 && dt < 7.5 && /^5,4,3,2,1,x\(start\)$/.test(seqB)) pass(`geri sayım bitti → yarış kendiliğinden başladı (${dt.toFixed(1)} sn), üyedeki sayım: ${seqB}`);
    else fail(`sayım/başlama: ${dt.toFixed(1)} sn, üye sayımı ${seqB}`);
  });

  let B2 = null;
  await step('yarış ortasında yenileme', async () => {
    await waitFor(() => Bm.FM.S.mode === 'race' && Bm.FM.S.raceT > 9, 30000, 'yarış ilerledi');
    // yönlü atış ağda (TUR5 §2.3): üye testereyi GERİYE atar → ev sahibinin dünyasında aynı kimlikli testere geriye gider, p.ax/p.ay aynı
    {
      const PA = Am.FM.S.player; let got = null, sent = null;
      const hEv = d => { if (d.net && d.r && d.r.pid === Am.net.pid() && d.item === 'saw') got = { ax: d.p.ax, ay: d.p.ay, vx: d.p.vx }; };
      H.FM.on('item:use', hEv);
      if (PA && !PA.dead && !PA.finished && !PA.out) {
        PA.item = 'saw'; Am.FM.game.useItem(PA, -1, 0);
        const e = Am.FM.S.ents.find(q => q.type === 'saw' && q.o === PA); sent = e ? { nid: e.nid, vx: Math.round(e.vx) } : null;
      }
      if (sent) {
        await waitFor(() => got, 3000, 'yönlü testere ev sahibinde');
        const he = H.FM.S.ents.find(q => q.nid === sent.nid);
        if (got.ax === -1 && got.ay === 0 && got.vx < 0 && (!he || he.vx < 0)) pass(`yönlü atış ağdan geçti: geriye atılan testere (ax -1, ay 0, vx ${got.vx}) ev sahibinde de geriye`);
        else fail('yönlü atış: gönderilen ' + JSON.stringify(sent) + ', ev sahibi ' + JSON.stringify(got));
      } else console.log('    (yönlü atış denemesi atlandı: oyuncu ölü/bitirmiş)');
      H.FM.off('item:use', hEv);
    }
    const xB = Math.round(Bm.FM.S.player.x), pidB = Bm.net.pid(), mid = Bm.ng.state().mid;
    refresh(Bm);
    await waitFor(() => { const r = H.ng.racer(pidB); return r && r.off; }, 9000, 'ev sahibinde "bağlantı koptu"');
    B2 = mk('Barış', { store: Bm.store });
    if (B2.net.pid() !== pidB) throw new Error('pid korunmadı: ' + B2.net.pid());
    const info = B2.ng.rejoinInfo();
    if (!info || info.code !== code) throw new Error('rejoinInfo: ' + JSON.stringify(info));
    if (!B2.ng.rejoin()) throw new Error('rejoin false');
    await waitFor(() => B2.count('mp:start') >= 1 && B2.ng.state().phase === 'race', 15000, 'geri dönen yarışta');
    const st = B2.ng.state(), P = B2.FM.S.player, x2 = Math.round(P.x);
    await waitFor(() => { const r = H.ng.racer(pidB); return r && !r.off && !r.out; }, 9000, 'ev sahibinde geri geldi');
    if (B2.count('mp:rejoining') && !st.spectating && st.mid === mid && P.ctrl === 'local' && x2 > 600 && Math.abs(x2 - xB) < 1500) pass(`yenileyen üye ${info.mins} dk'lık kayıtla aynı yarışa AYNI yarışçı olarak döndü (yenilemeden önce x=${xB}, dönünce x=${x2}; başlangıç değil), ev sahibinde "koptu" kalktı`);
    else fail('geri dönüş: ' + JSON.stringify({ st, x2, xB, ctrl: P.ctrl, rej: B2.count('mp:rejoining') }));
  });
  const M3 = [H, Am, B2 || Bm];

  await step('turlar arası otomatik geçiş', async () => {
    await waitFor(() => M3.every(g => g.count('mp:end') >= 1), 120000, 'tur 1 sonu');
    await sleep(300);
    const al = M3.map(g => g.ng.autoLeft());
    const tEnd = Date.now();
    if (al.every(v => v != null && v >= 6 && v <= 9)) pass('tur sonu: kalan süre herkeste (üyeler dahil) autoLeft = ' + al.join('/'));
    else fail('autoLeft: ' + JSON.stringify(al));
    await waitFor(() => M3.every(g => g.ng.state().round === 2 && g.ng.state().phase === 'race'), 20000, 'tur 2 kendiliğinden');
    const s = (Date.now() - tEnd) / 1000;
    if (s > 6 && s < 10.5) pass(`sonraki tur ${s.toFixed(1)} sn sonra kendiliğinden başladı (kürsüden ~6 sn sonra)`); else fail('tur 2 gecikmesi ' + s.toFixed(1) + ' sn');
  });

  await step('maç sonu → herkes lobiye', async () => {
    await waitFor(() => M3.every(g => g.count('mp:final') >= 1), 150000, 'final');
    await sleep(300);
    const fs = H.last('mp:final').d.standings.find(x => x.pid === Am.net.pid());
    if (!fs || fs.hat !== 'parti') fail('final sıralamasında şapka yok: ' + JSON.stringify(fs));
    const al = M3.map(g => g.ng.autoLeft());
    if (al.every(v => v != null && v >= 8 && v <= 10)) pass('final: lobiye dönüşe kalan süre herkeste ' + al.join('/')); else fail('final autoLeft: ' + JSON.stringify(al));
    const tF = Date.now();
    await waitFor(() => M3.every(g => g.ev.some(x => x.e === 'mp:lobby' && x.t > tF)), 16000, 'lobiye dönüş');
    const s = (Date.now() - tF) / 1000;
    const lob = H.net.lobby(), pl = H.net.players();
    const okRoom = M3.every(g => g.net.inRoom() && g.net.code() === code && g.ng.state().phase === 'lobby' && g.count('mp:left') === 0);
    const rdy = M3.map(g => !!g.net._dbg.R.ready).concat(M3.map(g => g.net.players().some(p => p.ready)));
    if (rdy.some(Boolean)) fail('lobiye dönünce hazır bayrağı kaldı (R.ready / players().ready): ' + JSON.stringify(rdy));
    await sleep(6500);
    if (M3.some(g => g.ng.countdown() != null || g.ng.state().phase !== 'lobby')) fail('lobiye dönünce bayat bayrakla geri sayım/yarış başladı');
    if (okRoom && pl.length === 3 && pl.every(p => !p.ready) && lob.st === 'lobby') pass(`final'den ${s.toFixed(1)} sn sonra herkes AYNI odada (${code}) lobide; 3 oyuncu korundu, hazırlar HERKESTE sıfır (R.ready ve lobi), 6.5 sn bekleyince de geri sayım başlamadı, kimse menüye atılmadı`);
    else fail('lobiye dönüş: ' + JSON.stringify({ okRoom, n: pl.length, ready: pl.map(p => p.ready), st: lob.st }));
  });

  let H2 = null;
  await step('ev sahibi lobide yeniledi', async () => {
    const pidH = H.net.pid();
    refresh(H);
    await waitFor(() => [Am, B2].every(g => g.net.isHost() || g.net.host() !== pidH), 12000, 'devir');
    H2 = mk('Ev', { store: H.store });
    if (!H2.ng.rejoin()) throw new Error('rejoin false');
    await waitFor(() => H2.net.inRoom() && H2.net.code() === code, 15000, 'ev sahibi geri döndü');
    await sleep(1500);
    const hosts = [Am, B2, H2].filter(g => g.net.isHost()).length;
    if (hosts === 1 && H2.net.players().length === 3 && !H2.net.isHost()) pass('ev sahibi sayfayı yeniledi → oda en küçük pid\'e devredildi, kendisi aynı odaya üye olarak döndü (tek ev sahibi, 3 oyuncu)');
    else fail('ev sahibi dönüşü: ' + JSON.stringify({ hosts, n: H2.net.players().length, host: H2.net.isHost() }));
  });

  await step('tek başına ev sahibi odayı geri alır', async () => {
    const others = [Am, B2, H2].filter(Boolean);
    const solo = others.find(g => g.net.isHost());
    for (const g of others) if (g !== solo) g.stop();               // bilerek çıkış (kayıt silinir)
    await waitFor(() => solo.net.players().length === 1, 12000, 'yalnız kaldı');
    if (others.filter(g => g !== solo).some(g => g.net.lastRoom())) throw new Error('bilerek çıkışta kayıt silinmedi');
    refresh(solo);
    const S2 = mk('Yalnız', { store: solo.store });
    const t0 = Date.now();
    if (!S2.ng.rejoin()) throw new Error('rejoin false');
    await waitFor(() => S2.net.inRoom() && S2.net.isHost(), 12000, 'oda geri alındı');
    if (S2.net.code() === code && S2.count('mp:lobby') >= 1) pass(`tek başına ev sahibi yeniledi → ${((Date.now() - t0) / 1000).toFixed(1)} sn içinde aynı odayı (${code}) ev sahibi olarak geri aldı`);
    else fail('geri alma: ' + S2.net.code());
    S2.stop();
    await sleep(500);
    if (S2.net.lastRoom()) fail('leaveRoom sonrası kayıt duruyor'); else pass('ODADAN AYRIL → geri dönüş kaydı silindi');
  });

  await step('olmayan odaya geri dönüş', async () => {
    const X = mk('Kayıp');
    X.store['fm-oda'] = JSON.stringify({ code, broker: 1, t: Date.now() - 60000, pid: X.net.pid(), hn: 'Ev', live: 0, closed: Date.now() - 60000 });
    const info = X.ng.rejoinInfo();
    if (!info || info.mins !== 1 || info.nick !== 'Ev') throw new Error('rejoinInfo: ' + JSON.stringify(info));
    X.ng.rejoin();
    await waitFor(() => X.ev.some(x => x.e === 'mp:left' && x.d && x.d.reason === 'rejoin-failed'), 20000, 'rejoin-failed');
    if (!X.net.lastRoom() && !X.net.busy()) pass('kapanmış odaya geri dönüş → mp:left {reason: "rejoin-failed"}, kayıt silindi'); else fail('başarısız dönüşte kayıt/oturum kaldı');
    X.stop();
  });

  const errs = all.reduce((a, g) => a.concat(g.errors), []);
  const caught = all.reduce((a, g) => a.concat(g.net.log().filter(l => l.indexOf('HATA') >= 0)), []);
  if (!errs.length && !caught.length) pass('konsol hatası yok'); else { fail(errs.length + caught.length + ' hata'); for (const e of errs.concat(caught).slice(0, 8)) console.log('      ' + String(e).slice(0, 300)); }
  console.log(`\nSonuç: ${bad ? bad + ' kaldı' : 'hepsi geçti'} (${el()})`);
  return bad;
}

/* =================== TUR6: doğrudan bağlantı ağı (node dev/mp-bots.js p2p --yerel) =================== */
async function p2pFlow(all) {
  let bad = 0; const t00 = Date.now();
  const pass = m => console.log('  ✓ ' + m), fail = m => { bad++; console.log('  ✗ ' + m); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { fail(name + ' — ' + (e && e.message)); } };
  const mk = (n, o) => { const g = ghost(n, Object.assign({ quiet: true }, o || {})); all.push(g); g.ng.autopilot = true; return g; };
  const net = { lat: 12, jit: 8, loss: 0.02, setup: 150 };
  const H = mk('Ev', { char: 'Kral', rtc: { net } }), G = [H, mk('Ayşe', { rtc: {} }), mk('Barış', { rtc: {} }), mk('Cem', { rtc: {} })];
  H.net.createRoom({ cfg: { mode: 'classic', map: 'random', rounds: 1, bots: true, fill: 6 } });
  await waitFor(() => H.net.inRoom(), 20000, 'oda');
  const code = H.net.code();
  for (const g of G.slice(1)) { g.net.joinRoom(code); await sleep(200); }
  await waitFor(() => G.every(g => g.net.inRoom()) && H.net.players().length === 4, 20000, 'herkes odada');
  console.log('oda ' + code + ' — 4 oyuncu, sahte WebRTC (gecikme ' + net.lat + ' ms, kayıp %' + net.loss * 100 + ')');
  const links = g => g.net.players().filter(p => !p.me).map(p => p.link);
  await step('tam örgü', async () => {
    const t0 = Date.now();
    await waitFor(() => G.every(g => links(g).length === 3 && links(g).every(l => l === 'p2p')), 25000, '6 bağlantının hepsi p2p');
    const st = G.map(g => g.net._dbg.rtc.stats());
    pass(`4 oyuncu tam örgü (6 doğrudan bağlantı) ${((Date.now() - t0) / 1000).toFixed(1)} sn içinde kuruldu; açılan ${st.map(x => x.opened).join('/')}, başarısız ${st.map(x => x.failed).join('/')}, sinyal gönderilen ${st.map(x => x.sigOut).join('/')}`);
  });
  const rate = async ms => { const a = G.map(g => g.net._dbg.rtc.stats()); await sleep(ms); return G.map((g, i) => { const b = g.net._dbg.rtc.stats(); return { dc: (b.stDc - a[i].stDc) / ms * 1000, mq: (b.stMq - a[i].stMq) / ms * 1000 }; }); };
  let late = null;
  await step('herkes doğrudan: aracı durumu ~1 Hz', async () => {
    for (const g of G) g.net.setReady(true);
    await waitFor(() => G.every(g => g.ng.state().phase === 'race'), 15000, 'yarış');
    await waitFor(() => H.FM.S.mode === 'race' && H.FM.S.raceT > 3, 15000, 'yarış ilerledi');
    const r = await rate(4000);
    // alıcı başına: 3 gönderenden toplam
    const okR = r.every(x => x.dc >= 3 * 12 && x.mq <= 3 * 1.5);
    const dly = G[1].net.links().map(l => l.dly);
    if (okR) pass('yarışta durum doğrudan (alıcı başına 3 gönderenden ' + r.map(x => Math.round(x.dc)).join('/') + ' msg/sn), aracıdan yalnız ' + r.map(x => x.mq.toFixed(1)).join('/') + ' msg/sn yedek; ara değerleme ' + dly.join('/') + ' ms');
    else fail('oranlar: ' + JSON.stringify(r));
  });
  await step('WebRTC\'siz oyuncu gelince aracı normal hızda', async () => {
    late = mk('Eski', { rtc: null });                                  // RTCPeerConnection yok (eski tarayıcı / uygulama içi tarayıcı)
    late.net.joinRoom(code);
    await waitFor(() => late.net.inRoom() && late.ng.state().phase === 'race', 20000, 'geç gelen izliyor');
    await sleep(2500);
    const r = await rate(3000);
    const lk = H.net.players().find(p => p.pid === late.net.pid());
    const seen = G.map(g => late.net.sample(g.net.pid())).filter(x => x && !x._stale).length;
    if (r.every(x => x.mq >= 3 * 6) && lk && lk.link === 'mqtt' && seen >= 3) pass('WebRTC\'siz oyuncu odada → herkes aracıya da normal hızda yayınlıyor (' + r.map(x => Math.round(x.mq)).join('/') + ' msg/sn), o oyuncu diğer ' + seen + ' yarışçıyı canlı görüyor; aradakiler yine doğrudan');
    else fail('karma oda: ' + JSON.stringify({ r, lk: lk && lk.link, seen }));
  });
  await step('sonuç + olaylar', async () => {
    await waitFor(() => G.concat([late]).every(g => g.count('mp:end') >= 1), 150000, 'tur sonu');
    const sigs = G.concat([late]).map(g => endSig(g.last('mp:end').d));
    if (sigs.every(x => x === sigs[0])) pass('tur sonucu 5 istemcide aynı'); else fail('sonuçlar farklı: ' + sigs.join(' | '));
    // her alıcı her gönderenin her eşya olayını TAM BİR KEZ uyguladı mı (doğrudan + aracı yedeği tekrar atıldı mı)
    const sent = G.map(g => g.ng.debug().stats.sent.it || 0), recv = G.map(g => g.ng.debug().stats.recv.it || 0), dup = G.map(g => g.net._dbg.rtc.stats().evDup);
    const exp = G.map((g, i) => sent.reduce((a, v, j) => a + (j === i ? 0 : v), 0));
    if (recv.every((v, i) => v === exp[i]) && dup.every(d => d > 0)) pass(`olaylar: her alıcı her eşya olayını bir kez aldı (alınan ${recv.join('/')} = beklenen ${exp.join('/')}), iki yoldan gelen tekrarlar atıldı (${dup.join('/')})`);
    else fail('olay sayıları: ' + JSON.stringify({ sent, recv, exp, dup }));
  });
  const errs = all.reduce((a, g) => a.concat(g.errors), []), caught = all.reduce((a, g) => a.concat(g.net.log().filter(l => l.indexOf('HATA') >= 0)), []);
  if (!errs.length && !caught.length) pass('konsol hatası yok'); else { fail(errs.length + caught.length + ' hata'); for (const e of errs.concat(caught).slice(0, 8)) console.log('      ' + String(e).slice(0, 300)); }
  console.log(`\nSonuç: ${bad ? bad + ' kaldı' : 'hepsi geçti'} (${((Date.now() - t00) / 1000).toFixed(1)} sn)`);
  return bad;
}
