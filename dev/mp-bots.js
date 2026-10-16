// Kullanım:
//   node dev/mp-bots.js host [oyuncu=4] [mod=classic] [tema=random] [tur=1] [doldur=4] [aracı] [--hostdrop=SN] [--drop=SN] [--late=SN]
//       → node'da N "hayalet" oyuncu; ilki odayı kurar, hepsi katılınca maçı başlatır, maç bitene kadar oynar, sonra
//         tüm istemcilerde tur sonuçlarının (sıralama + puan) AYNI olduğunu, uzak yarışçıların hareket ettiğini, olayların
//         karşıya geçtiğini ve konsol hatası olmadığını denetler.
//   node dev/mp-bots.js join KOD [oyuncu=3] [sn=240]
//   node dev/mp-bots.js lobi [--yerel]
//       → TUR5 lobi akışı: herkes HAZIR → 5 sn geri sayım (mp:countdown herkeste) → yarış; hazırı geri alma iptali; turlar arası
//         otomatik geçiş + üyede autoLeft(); final sonrası herkes LOBİYE (aynı oda); yarış ortasında yenileyen üyenin aynı yarışçıya dönmesi.
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
