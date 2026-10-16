// Kullanım: node dev/mp-browser.js [hayalet=0] [mod=classic] [tema=0] [tur=1] [doldur=4] [çıktı klasörü]
// GERÇEK oyun sayfası İKİ headless Chrome'da (ev sahibi + katılan, --mute-audio) + isteğe bağlı N node hayalet oyuncu aynı odada.
// Sayfalar geliştirici kancalarıyla açılır: index.html?dev=1&mp=host&want=K... ve ?dev=1&mp=join&room=KOD (otomatik pilot).
// DevTools protokolüyle (global WebSocket) denetler: iki tarafta da diğer oyuncu hareket ediyor mu (uzak konum ≈ gerçek konum),
// eşya olayları karşıya geçiyor mu, tur sonucu ve final herkeste aynı mı, konsol hatası var mı; iki ekranın görüntüsünü kaydeder.
// 10 kişilik oda: node dev/mp-browser.js 8 classic 0 1 10
// YAVAŞ MOD: en fazla 2 Chrome; iş bitince tüm Chrome'lar ve hayaletler kapatılır.
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { ghost, sleep, waitFor, endSig } = require('./mp-bots.js');
const root = path.resolve(__dirname, '..');
const chromePath = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && fs.existsSync(p));
if (!chromePath) { console.error('Chrome/Edge bulunamadı'); process.exit(1); }
// --late: katılan tarayıcı yarış başladıktan 8 sn sonra girer → izleyici (hayalet oyuncu) ekranı, sonraki turda yarışır (tur ≥ 2 olmalı)
const LATE = process.argv.includes('--late');
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const NG = Math.max(0, Math.min(8, +(ARGS[0] || 0)));
const MODE = ARGS[1] || 'classic', THEME = ARGS[2] || '0', ROUNDS = Math.max(LATE ? 2 : 1, +(ARGS[3] || 1)), FILL = +(ARGS[4] || 4);
const OUT = path.resolve(ARGS[5] || path.join(os.tmpdir(), 'fm-mp-shots'));
fs.mkdirSync(OUT, { recursive: true });

function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const cb = {}; const hs = [];
  const api = {
    ready: new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP bağlanamadı')); }),
    on: h => hs.push(h),
    send: (method, params) => new Promise(res => { const i = ++id; cb[i] = res; ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
    eval: async expr => {
      const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.error) throw new Error(r.error.message);
      if (r.result.exceptionDetails) throw new Error('sayfa: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    },
    shot: async file => { const r = await api.send('Page.captureScreenshot', { format: 'png' }); if (r.result && r.result.data) { fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); return true; } return false; },
    close: () => { try { ws.close(); } catch (e) { } }
  };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.id && cb[m.id]) { cb[m.id](m); delete cb[m.id]; } else if (m.method) for (const h of hs) h(m); };
  return api;
}
const procs = [];
async function openPage(name, query) {
  const profile = path.join(os.tmpdir(), 'fm-mpb-' + name + '-' + process.pid);
  const url = 'file:///' + root.split(path.sep).join('/') + '/index.html?' + query;
  const ch = spawn(chromePath, ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--user-data-dir=' + profile, '--window-size=844,390', url], { stdio: 'ignore' });
  procs.push({ ch, profile });
  const portFile = path.join(profile, 'DevToolsActivePort');
  await waitFor(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0], 20000, name + ' hata ayıklama portu');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  let target = null;
  await waitFor(async () => { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = l.find(t => t.type === 'page' && t.url.indexOf('index.html') >= 0); return !!target; }, 20000, name + ' sayfa hedefi');
  const page = cdp(target.webSocketDebuggerUrl); await page.ready;
  page.errs = [];
  page.on(m => {
    if (m.method === 'Runtime.exceptionThrown') page.errs.push('istisna: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) page.errs.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 400));
  });
  await page.send('Runtime.enable'); await page.send('Page.enable');
  await waitFor(() => page.eval('!!(window.FM && FM.netgame && FM.S && FM.S.mode !== "boot")'), 25000, name + ' oyun yüklendi');
  await page.eval('window.__mp = []; for (const e of ["mp:start","mp:end","mp:final","mp:lobby","mp:host","mp:waiting","mp:drop","net:error"]) FM.on(e, d => __mp.push({e, t: Date.now(), d: (e === "mp:end" || e === "mp:final") ? JSON.parse(JSON.stringify(d)) : null})); true');
  page.name = name;
  return page;
}
// geç katılma: ev sahibi (+ hayaletler) başlar, katılan tarayıcı yarış sürerken girer → izleyici; sonraki turda yarışır
async function lateFlow(pass, fail, ghosts) {
  const A = await openPage('evsahibi', `dev=1&mp=host&mobile=1&want=${1 + NG}&wait=60&mode=${MODE}&theme=${THEME}&rounds=${ROUNDS}&fill=${FILL}&mpauto=6`);
  await waitFor(() => A.eval('FM.net.inRoom()'), 30000, 'ev sahibi odayı kurdu');
  const code = await A.eval('FM.net.code()');
  console.log(`oda ${code} — geç katılma: ev sahibi + ${NG} hayalet başlar, katılan tarayıcı 8 sn sonra girer; mod ${MODE}, ${ROUNDS} tur`);
  for (let i = 0; i < NG; i++) { const g = ghost('Hayalet' + (i + 1), { quiet: true }); ghosts.push(g); g.net.joinRoom(code); await sleep(300); }
  await waitFor(async () => (await A.eval('FM.netgame.state().phase')) === 'race', 90000, 'yarış başladı');
  await sleep(8000);
  const B = await openPage('katilan', `dev=1&mp=join&room=${code}&mobile=1`);
  await waitFor(async () => { const s = await B.eval('FM.netgame.state()'); return s.phase === 'race' && s.spectating; }, 30000, 'katılan izleyici oldu');
  await sleep(3000);
  const sb = await B.eval('({lt: FM.S.lt, mode: FM.S.mode, ghost: !!(FM.S.player && FM.S.player.ghost), spec: FM.S.spec && FM.S.spec.name, n: FM.S.racers.length})');
  const sa = await A.eval('({lt: FM.S.lt})');
  const dl = Math.round(Math.abs(sb.lt - sa.lt) * 1000);
  if (sb.ghost && sb.spec && dl < 500) pass(`geç katılan izleyici: "${sb.spec}" izleniyor, ${sb.n} yarışçı, seviye saati farkı ${dl} ms`); else fail('izleyici: ' + JSON.stringify(sb) + ' ev sahibi ' + JSON.stringify(sa));
  const f1 = path.join(OUT, 'mp-izleyici-katilan.png'); await B.shot(f1); console.log('    ekran: ' + f1);
  await waitFor(() => B.eval('__mp.some(x => x.e === "mp:end")'), 200000, 'tur 1 sonu (izleyicide)');
  await sleep(2500);
  const f2 = path.join(OUT, 'mp-izleyici-kursu.png'); await B.shot(f2); console.log('    ekran: ' + f2);
  await waitFor(async () => { const s = await B.eval('FM.netgame.state()'); return s.phase === 'race' && s.round === 2 && !s.spectating; }, 60000, 'tur 2: katılan yarışta');
  pass('sonraki turda katılan kadroya girdi ve yarışıyor');
  await sleep(10000);
  const f3 = path.join(OUT, 'mp-tur2-katilan.png'); await B.shot(f3); console.log('    ekran: ' + f3);
  await waitFor(async () => (await A.eval('__mp.filter(x => x.e === "mp:end").length')) >= 2 && (await B.eval('__mp.filter(x => x.e === "mp:end").length')) >= 2, 220000, 'tur 2 sonu');
  const eA = await A.eval('__mp.filter(x => x.e === "mp:end").map(x => x.d)'), eB = await B.eval('__mp.filter(x => x.e === "mp:end").map(x => x.d)');
  for (let rd = 1; rd <= 2; rd++) {
    const a = endSig(eA.find(d => d.round === rd)), b = endSig(eB.find(d => d.round === rd)), gs = ghosts.map(g => endSig((g.ev.filter(x => x.e === 'mp:end').map(x => x.d)).find(d => d.round === rd)));
    if (a === b && gs.every(s => s === a) && a !== 'yok') pass(`tur ${rd} sonucu herkeste aynı: ` + eA.find(d => d.round === rd).ranking.map(e => e.nick + ' +' + e.rp).join(', '));
    else fail(`tur ${rd} farklı: ${a} | ${b} | ${gs.join(' | ')}`);
  }
  const errs = A.errs.concat(B.errs, ghosts.reduce((x, g) => x.concat(g.errors), []));
  if (!errs.length) pass('konsol hatası yok'); else { fail(errs.length + ' hata'); for (const e of errs.slice(0, 10)) console.log('      ' + e.slice(0, 300)); }
  A.close(); B.close();
}
function killAll() {
  for (const p of procs) { try { p.ch.kill(); } catch (e) { } }
  setTimeout(() => { for (const p of procs) { try { fs.rmSync(p.profile, { recursive: true, force: true }); } catch (e) { } } }, 800);
}
process.on('exit', killAll);

(async () => {
  const ok = [], bad = [];
  const pass = m => { ok.push(m); console.log('  ✓ ' + m); }, fail = m => { bad.push(m); console.log('  ✗ ' + m); };
  const ghosts = [];
  const t00 = Date.now();
  try {
    main: {
    if (LATE) { await lateFlow(pass, fail, ghosts); break main; }
    const want = 2 + NG;
    const A = await openPage('evsahibi', `dev=1&mp=host&mobile=1&want=${want}&wait=90&mode=${MODE}&theme=${THEME}&rounds=${ROUNDS}&fill=${FILL}&mpauto=6`);
    await waitFor(() => A.eval('FM.net.inRoom()'), 30000, 'ev sahibi odayı kurdu');
    const code = await A.eval('FM.net.code()');
    console.log(`oda ${code} (${await A.eval('FM.net.status().brokerName')}) — 2 tarayıcı + ${NG} hayalet, mod ${MODE}, tema ${THEME}, ${ROUNDS} tur, doldurma ${FILL}`);
    const B = await openPage('katilan', `dev=1&mp=join&room=${code}&mobile=1`);
    for (let i = 0; i < NG; i++) { const g = ghost('Hayalet' + (i + 1), { quiet: true }); ghosts.push(g); g.net.joinRoom(code); await sleep(300); }
    await waitFor(async () => (await A.eval('FM.netgame.state().phase')) === 'race' && (await B.eval('FM.netgame.state().phase')) === 'race' && ghosts.every(g => g.ng.state().phase === 'race'), 120000, 'yarış herkeste başladı');
    pass(`yarış başladı (${((Date.now() - t00) / 1000).toFixed(1)} sn): ev sahibi ${await A.eval('FM.net.pid()')}, katılan ${await B.eval('FM.net.pid()')}`);
    const mapA = await A.eval('FM.S.L.theme.id + "/" + Math.round(FM.S.L.end) + "/" + FM.S.L.solids.length'), mapB = await B.eval('FM.S.L.theme.id + "/" + Math.round(FM.S.L.end) + "/" + FM.S.L.solids.length');
    if (mapA === mapB) pass('iki tarafta aynı harita: ' + mapA); else fail('harita farklı: ' + mapA + ' / ' + mapB);
    // yarış boyunca: karşı taraftaki oyuncunun görüntüsü gerçek konumuna yakın mı
    const shot = async (tag) => {
      const fa = path.join(OUT, `mp-${tag}-evsahibi.png`), fb = path.join(OUT, `mp-${tag}-katilan.png`);
      await A.shot(fa); await B.shot(fb);
      console.log('    ekran: ' + fa + '\n           ' + fb);
    };
    let near = 0, checks = 0, maxGap = 0, itemsB = 0, itemsA = 0, nidsSeen = 0;
    for (let k = 0; k < 8; k++) {
      await sleep(k === 0 ? 7000 : 3000);
      const [dA, dB] = await Promise.all([A.eval('FM.netgame.debug()'), B.eval('FM.netgame.debug()')]);
      if (dA.M.phase !== 'race' || dB.M.phase !== 'race') break;
      for (const [me, other, tag] of [[dA, dB, 'ev sahibi→katılan'], [dB, dA, 'katılan→ev sahibi']]) {
        const mine = other.racers.find(r => r.ctrl === 'local');
        const seen = me.racers.find(r => mine && r.pid === mine.pid);
        if (!mine || !seen || mine.out || mine.dead || seen.dead) continue;
        checks++;
        const gap = Math.abs(mine.x - seen.x); maxGap = Math.max(maxGap, gap);
        if (gap < 380 && seen.x > 200) near++;
        if (k === 1 || k === 4) console.log(`    ${tag}: gerçek x=${mine.x}, görülen x=${seen.x} (fark ${gap} px), canlı ${me.racers.filter(r => !r.out).length}, varlık ${me.ents} (ağ kimlikli ${me.nids})`);
      }
      itemsA = dA.stats.recv.it || 0; itemsB = dB.stats.recv.it || 0; nidsSeen = Math.max(nidsSeen, dA.nids, dB.nids);
      if (k === 1) await shot('yaris1');
      if (k === 4) await shot('yaris2');
      if (k === 2) {
        // doğrudan deneme: katılan testere fırlatır → ev sahibinin dünyasında aynı ağ kimlikli testere, katılanın yarışçısının yanında belirmeli
        const used = await B.eval('(() => { const P = FM.S.player; if (!P || P.dead > 0 || P.finished || P.out) return null; P.item = "saw"; FM.game.useItem(P); const e = FM.S.ents.find(e => e.type === "saw" && e.o === P); return e ? {nid: e.nid, x: Math.round(e.x), px: Math.round(P.x)} : null; })()');
        if (used && used.nid) {
          let got = null;
          const r0 = await A.eval('JSON.stringify({it: FM.netgame.debug().stats.recv.it || 0, nids: FM.S.ents.map(e => e.nid).filter(Boolean)})');
          const tq = Date.now();
          for (let w = 0; w < 40 && !got; w++) { await sleep(60); got = await A.eval(`(() => { const e = FM.S.ents.find(e => e.nid === ${JSON.stringify(used.nid)}); if (!e) return null; const o = e.o; return {x: Math.round(e.x), ox: Math.round(o.x), owner: o.name, ctrl: o.ctrl}; })()`); }
          console.log(`    (testere ${Date.now() - tq} ms içinde ${got ? 'bulundu' : 'bulunamadı'}; önce ${r0}; sonra ${await A.eval('JSON.stringify({it: FM.netgame.debug().stats.recv.it || 0, inQ: FM.netgame.debug().inQ, delay: FM.net.delay(' + JSON.stringify(used.nid.split('.')[0]) + '), nids: FM.S.ents.map(e => e.nid).filter(Boolean), mode: FM.S.mode, paused: FM.S.paused})')})`);
          if (got) {
            await A.shot(path.join(OUT, 'mp-testere-evsahibi.png'));
            console.log(`    testere: katılanda x=${used.x} (oyuncu ${used.px}) → ev sahibinde ${got.owner} (${got.ctrl}) yanında x=${got.x} (görülen oyuncu ${got.ox}); ekran ${path.join(OUT, 'mp-testere-evsahibi.png')}`);
            if (got.ctrl === 'remote' && Math.abs(got.x - got.ox) < 260) pass('katılanın testeresi ev sahibinde aynı kimlikle, sahibinin (uzak yarışçı) yanında belirdi');
            else fail('testere konumu: ' + JSON.stringify(got));
          } else fail('testere ev sahibine geçmedi (' + used.nid + ')');
        }
      }
    }
    if (checks && near >= checks * .8) pass(`iki tarafta da karşı oyuncu hareket ediyor, görüntü gerçek konuma yakın (${near}/${checks}, en büyük fark ${maxGap} px)`);
    else fail(`uzak konum: ${near}/${checks} yakın, en büyük fark ${maxGap} px`);
    if (itemsA > 0 && itemsB > 0) pass(`eşya olayları iki yöne geçti (ev sahibi ${itemsA}, katılan ${itemsB} aldı; ağ kimlikli varlık en çok ${nidsSeen})`); else fail(`eşya olayı: ev sahibi ${itemsA}, katılan ${itemsB}`);
    // tur sonu
    await waitFor(async () => (await A.eval('__mp.some(x => x.e === "mp:end")')) && (await B.eval('__mp.some(x => x.e === "mp:end")')) && ghosts.every(g => g.count('mp:end') >= 1), 220000, 'tur sonu');
    await sleep(2500);
    await shot('kursu');
    const eA = await A.eval('__mp.find(x => x.e === "mp:end").d'), eB = await B.eval('__mp.find(x => x.e === "mp:end").d');
    const sigs = [endSig(eA), endSig(eB)].concat(ghosts.map(g => endSig(g.ev.find(x => x.e === 'mp:end').d)));
    if (sigs.every(s => s === sigs[0])) pass('tur sonucu herkeste aynı: ' + eA.ranking.map(e => e.nick + (e.me ? '*' : '') + (e.finished ? '' : '(—)') + ' +' + e.rp).join(', '));
    else fail('tur sonucu farklı:\n      ' + sigs.join('\n      '));
    const pr = await B.eval('({mode: FM.S.mode, res: FM.S.lastResult && FM.S.lastResult.ranking.map(r => r.name).join(","), rank: FM.S.lastResult && FM.S.lastResult.playerRank})');
    console.log(`    katılanın ekranı: mod ${pr.mode}, kürsü sırası ${pr.res}, kendi sırası ${pr.rank + 1}`);
    if (ROUNDS === 1) {
      await waitFor(async () => (await A.eval('__mp.some(x => x.e === "mp:final")')) && (await B.eval('__mp.some(x => x.e === "mp:final")')), 30000, 'final').catch(e => fail(e.message));
      const fA = await A.eval('(__mp.find(x => x.e === "mp:final") || {}).d'), fB = await B.eval('(__mp.find(x => x.e === "mp:final") || {}).d');
      const s = d => d ? d.standings.map(x => x.pid + ':' + x.total).join(',') : 'yok';
      if (s(fA) === s(fB) && s(fA) !== 'yok') pass('final sıralaması iki tarayıcıda aynı'); else fail('final farklı');
      await sleep(1500);
      await shot('final');
    }
    const eA2 = A.errs.concat(B.errs), eG = ghosts.reduce((a, g) => a.concat(g.errors), []);
    if (!eA2.length && !eG.length) pass('konsol hatası yok (2 tarayıcı + ' + NG + ' hayalet)');
    else { fail((eA2.length + eG.length) + ' hata'); for (const e of eA2.concat(eG).slice(0, 12)) console.log('      ' + e.slice(0, 300)); }
    const stA = await A.eval('FM.netgame.debug().stats'), stB = await B.eval('FM.netgame.debug().stats');
    console.log('    ev sahibi olay gönder/al: ' + JSON.stringify(stA.sent) + ' / ' + JSON.stringify(stA.recv));
    console.log('    katılan   olay gönder/al: ' + JSON.stringify(stB.sent) + ' / ' + JSON.stringify(stB.recv));
    A.close(); B.close();
    }
  } catch (e) { fail('HATA ' + (e.stack || e)); }
  for (const g of ghosts) g.stop();
  console.log(`\nSonuç: ${ok.length} geçti, ${bad.length} kaldı (${((Date.now() - t00) / 1000).toFixed(0)} sn). Ekran görüntüleri: ${OUT}`);
  killAll();
  setTimeout(() => process.exit(bad.length ? 1 : 0), 1200);
})();
