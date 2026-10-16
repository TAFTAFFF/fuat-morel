// Kullanım: node dev/mp-browser.js [hayalet=0] [mod=classic] [tema=0] [tur=1] [doldur=4] [çıktı klasörü]
// GERÇEK oyun sayfası İKİ headless Chrome'da (ev sahibi + katılan, --mute-audio) + isteğe bağlı N node hayalet oyuncu aynı odada.
// Sayfalar geliştirici kancalarıyla açılır: index.html?dev=1&mp=host&want=K... ve ?dev=1&mp=join&room=KOD (otomatik pilot).
// DevTools protokolüyle (global WebSocket) denetler: iki tarafta da diğer oyuncu hareket ediyor mu (uzak konum ≈ gerçek konum),
// eşya olayları karşıya geçiyor mu, tur sonucu ve final herkeste aynı mı, konsol hatası var mı; iki ekranın görüntüsünü kaydeder.
// 10 kişilik oda: node dev/mp-browser.js 8 classic 0 1 10
// YAVAŞ MOD: en fazla 2 Chrome; iş bitince tüm Chrome'lar ve hayaletler kapatılır.
// --yerel: dev/broker.js yerel aracısını başlatır (sayfalara ?brokerUrl=, hayaletlere de aynı aracı). NET_BROKER=ws://.../mqtt de olur.
// --tur5: TUR5 akışı (2 tarayıcı, dev kancaları + FM.net/FM.netgame API'leri; arayüz düğmelerine tıklamaz):
//   varlık listesi + profil kartları, ikisi HAZIR → 5 sn geri sayım → yarış, hazırı geri alma iptali, yarış ortasında katılan sayfayı
//   YENİDEN YÜKLER (otomatik geri dönüş, aynı yarışçı kaldığı yerden), turlar arası otomatik geçiş (üyede autoLeft), final → ikisi de
//   AYNI odada lobide (hazırlar sıfır), lobide yeniden yükleme → otomatik geri dönüş. Örn: node dev/mp-browser.js --yerel --tur5
// --p2p: doğrudan bağlantı (WebRTC) akışı: iki yönde P2P, durum/olay veri kanalından + aracı durumu ~1 Hz'e iner, tekrar atma,
//   kanal sessizce ölünce aracıya düşüş (oyun bozulmaz), yarışta yenileme → yeniden P2P, ev sahibi donunca göç; --rtcfail: katılanda
//   WebRTC kurulamaz (yalnız TURN politikası) → o eş için aracıyla sorunsuz yarış. Örn: node dev/mp-browser.js --yerel --p2p
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { ghost, sleep, waitFor, endSig, setBroker } = require('./mp-bots.js');
let BURL = process.env.NET_BROKER || null, LOCAL = null;
const TUR5 = process.argv.includes('--tur5');
const P2P = process.argv.includes('--p2p'), RTCFAIL = process.argv.includes('--rtcfail');
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
const pageUrl = query => 'file:///' + root.split(path.sep).join('/') + '/index.html?' + query + (BURL ? '&brokerUrl=' + encodeURIComponent(BURL) : '');
// olay kaydı sayfa betiklerinden ÖNCE kurulur (açılışta otomatik geri dönüş gibi erken olaylar kaçmasın; her yüklemede yeniden)
const CAPTURE = `(function w() { if (!(window.FM && FM.on)) { setTimeout(w, 4); return; } if (window.__mp) return; window.__mp = [];
  for (const e of ["mp:start","mp:end","mp:final","mp:lobby","mp:host","mp:waiting","mp:drop","net:error","mp:countdown","mp:rejoining","mp:left","net:came"])
    FM.on(e, d => { let x = null; try { x = (e === "mp:end" || e === "mp:final" || e === "mp:countdown" || e === "mp:left" || e === "net:came" || e === "mp:rejoining" || e === "net:error") ? JSON.parse(JSON.stringify(d)) : null; } catch (er) { } __mp.push({e, t: Date.now(), d: x}); });
})();`;
async function openPage(name, query) {
  const profile = path.join(os.tmpdir(), 'fm-mpb-' + name + '-' + process.pid);
  const url = pageUrl(query);
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
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE });
  await waitFor(() => page.eval('!!(window.FM && FM.netgame && FM.S && FM.S.mode !== "boot")'), 25000, name + ' oyun yüklendi');
  await page.eval(CAPTURE + ' true');
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
/* ---- TUR5: geri sayım, kalıcı lobi, yeniden yüklemede geri dönüş, varlık (2 tarayıcı) ---- */
async function tur5Flow(pass, fail) {
  const q = 'dev=1&mobile=1';
  const step = async (name, fn) => { try { await fn(); } catch (e) { fail(name + ' — ' + (e && e.message)); } };
  const A = await openPage('evsahibi', q + '&mp=host&want=99&wait=99999&mode=classic&theme=0&rounds=2&fill=3&mpauto=6');
  await waitFor(() => A.eval('FM.net.inRoom()'), 30000, 'ev sahibi odayı kurdu');
  const code = await A.eval('FM.net.code()');
  const B = await openPage('katilan', q + '&mp=join&room=' + code);
  await waitFor(async () => (await B.eval('FM.net.inRoom()')) && (await A.eval('FM.net.players().length')) === 2, 30000, 'katılan odada');
  const pidB = await B.eval('FM.net.pid()');
  console.log(`oda ${code} (${await A.eval('FM.net.status().brokerName')}) — TUR5 akışı, katılan ${pidB}`);
  const evs = (P, e) => P.eval('__mp.filter(x => x.e === ' + JSON.stringify(e) + ')');
  const cdSeq = async P => (await evs(P, 'mp:countdown')).map(x => x.d.left === null ? 'x(' + (x.d.reason || '') + ')' : x.d.left).join(',');
  const reloadB = async () => {
    await B.send('Page.navigate', { url: pageUrl(q) });             // mp/room kancası YOK → açılıştaki otomatik geri dönüş
    await sleep(400);
    await waitFor(() => B.eval('!!(window.FM && FM.netgame && FM.S && FM.S.mode !== "boot" && window.__mp)'), 25000, 'katılan yeniden yüklendi');
  };

  await step('varlık', async () => {
    await waitFor(async () => (await A.eval('FM.net.online().length')) === 2 && (await B.eval('FM.net.online().length')) === 2, 12000, 'iki tarayıcı birbirini çevrimiçi görür');
    await waitFor(async () => (await A.eval('FM.net.online().every(x => x.st === "lobby")')) && (await B.eval('FM.net.online().every(x => x.st === "lobby")')), 4000, 'ikisi de "lobide" görünür');
    const oa = await A.eval('FM.net.online().map(x => ({me: x.me, st: x.st, code: x.code, n: x.n}))');
    const pr = await A.eval('FM.net.profiles().find(x => !x.me)');
    const ps = await A.eval('FM.net.presence()');
    if (oa.every(x => x.st === 'lobby' && x.code === code && x.n === 2) && pr && pr.online && typeof pr.lvl === 'number' && typeof pr.play === 'number' && ps.shared)
      pass(`varlık: iki tarayıcı birbirini "Lobide · ${code} · 2/10" görüyor, profil kartı (seviye ${pr.lvl}, oynama ${pr.play} sn, kupa ${pr.tr}) geldi; oda bağlantısı paylaşılıyor`);
    else fail('varlık: ' + JSON.stringify({ oa, pr, ps }));
  });

  await step('geri sayım', async () => {
    await A.eval('FM.net.setReady(true)'); await B.eval('FM.net.setReady(true)');
    await waitFor(async () => (await A.eval('FM.netgame.countdown()')) != null && (await B.eval('FM.netgame.countdown()')) != null, 4000, 'geri sayım iki tarafta');
    await sleep(1300);
    await A.shot(path.join(OUT, 'tur5-gerisayim-evsahibi.png')); await B.shot(path.join(OUT, 'tur5-gerisayim-katilan.png'));
    await B.eval('FM.net.setReady(false)');
    await waitFor(async () => /x\(unready\)$/.test(await cdSeq(A)) && /x\(unready\)$/.test(await cdSeq(B)), 4000, 'iptal iki tarafta');
    await sleep(6000);
    if ((await A.eval('FM.netgame.state().phase')) !== 'lobby') throw new Error('iptalden sonra yarış başladı');
    pass('ikisi HAZIR → geri sayım iki tarayıcıda; katılan hazırı geri alınca iki tarafta iptal (unready), yarış başlamadı (' + await cdSeq(B) + ')');
    await A.eval('__mp = __mp.filter(x => x.e !== "mp:countdown"); true'); await B.eval('__mp = __mp.filter(x => x.e !== "mp:countdown"); true');
    const t0 = Date.now();
    await B.eval('FM.net.setReady(true)');
    await waitFor(async () => (await A.eval('FM.netgame.state().phase')) === 'race' && (await B.eval('FM.netgame.state().phase')) === 'race', 12000, 'yarış kendiliğinden başladı');
    const dt = (Date.now() - t0) / 1000, sb = await cdSeq(B), sa = await cdSeq(A);
    if (dt > 4.2 && dt < 8 && /^5,4,3,2,1,x\(start\)$/.test(sb) && /^5,4,3,2,1,x\(start\)$/.test(sa)) pass(`geri sayım 5…1 iki tarafta, ${dt.toFixed(1)} sn sonra yarış KENDİLİĞİNDEN başladı`);
    else fail(`sayım: ev sahibi ${sa} | katılan ${sb} | ${dt.toFixed(1)} sn`);
    await A.eval('FM.netgame.autopilot = true; if (FM.S.player) FM.S.player.bot = true; true');
    await B.eval('FM.netgame.autopilot = true; if (FM.S.player) FM.S.player.bot = true; true');
  });

  await step('yarış ortasında yeniden yükleme', async () => {
    await waitFor(async () => (await B.eval('FM.S.mode === "race" && FM.S.raceT > 9')), 30000, 'yarış ilerledi');
    const xB = await B.eval('Math.round(FM.S.player.x)');
    await reloadB();
    await waitFor(async () => (await B.eval('FM.netgame.state().phase')) === 'race', 15000, 'geri dönen yarışta');
    await B.eval('FM.netgame.autopilot = true; if (FM.S.player && FM.S.player.ctrl === "local") FM.S.player.bot = true; true');
    const st = await B.eval('({rej: __mp.filter(x => x.e === "mp:rejoining").map(x => x.d.code), spec: FM.netgame.state().spectating, ctrl: FM.S.player.ctrl, pid: FM.S.player.pid, x: Math.round(FM.S.player.x)})');
    await waitFor(async () => A.eval(`(() => { const r = FM.netgame.racer(${JSON.stringify(pidB)}); return !!r && !r.off && !r.out; })()`), 10000, 'ev sahibinde geri geldi');
    await sleep(2500);
    await B.shot(path.join(OUT, 'tur5-geridonus-katilan.png'));
    if (st.rej[0] === code && !st.spec && st.ctrl === 'local' && st.pid === pidB && st.x > 600 && Math.abs(st.x - xB) < 1500) pass(`yarışta sayfa yenilendi → otomatik geri dönüş (mp:rejoining ${code}), AYNI yarışçı kaldığı yerden (önce x=${xB}, sonra x=${st.x}); ev sahibinde "koptu" kalktı`);
    else fail('geri dönüş: ' + JSON.stringify(st) + ' önce x=' + xB);
  });

  await step('turlar arası otomatik geçiş', async () => {
    await waitFor(async () => (await evs(A, 'mp:end')).length >= 1 && (await evs(B, 'mp:end')).length >= 1, 150000, 'tur 1 sonu');
    await sleep(400);
    const al = [await A.eval('FM.netgame.autoLeft()'), await B.eval('FM.netgame.autoLeft()')];
    const t0 = Date.now();
    await sleep(1600);
    await B.shot(path.join(OUT, 'tur5-kursu-katilan.png'));
    await waitFor(async () => (await A.eval('FM.netgame.state().round')) === 2 && (await B.eval('FM.netgame.state().round')) === 2 && (await B.eval('FM.netgame.state().phase')) === 'race', 20000, 'tur 2');
    const s = (Date.now() - t0) / 1000 + 0.4;
    if (al.every(v => v >= 5 && v <= 9) && s > 5.5 && s < 10.5) pass(`tur sonu: autoLeft ev sahibi ${al[0]} / katılan ${al[1]}; ${s.toFixed(1)} sn sonra tur 2 kendiliğinden başladı`);
    else fail('otomatik geçiş: autoLeft ' + JSON.stringify(al) + ', ' + s.toFixed(1) + ' sn');
    await A.eval('if (FM.S.player) FM.S.player.bot = true; true'); await B.eval('if (FM.S.player) FM.S.player.bot = true; true');
  });

  await step('maç sonu → lobi', async () => {
    await waitFor(async () => (await evs(A, 'mp:final')).length >= 1 && (await evs(B, 'mp:final')).length >= 1, 160000, 'final');
    await sleep(1500);
    await B.shot(path.join(OUT, 'tur5-final-katilan.png'));
    const al = await B.eval('FM.netgame.autoLeft()');
    await waitFor(async () => (await A.eval('FM.netgame.state().phase')) === 'lobby' && (await B.eval('FM.netgame.state().phase')) === 'lobby', 16000, 'iki taraf lobide');
    await sleep(1200);
    const sa = await A.eval('({code: FM.net.code(), n: FM.net.players().length, rd: FM.net.players().map(p => p.ready), R: FM.net._dbg.R.ready, ui: FM.ui && FM.ui.state ? FM.ui.state() : null, left: __mp.filter(x => x.e === "mp:left").length})');
    const sb = await B.eval('({code: FM.net.code(), R: FM.net._dbg.R.ready, ui: FM.ui && FM.ui.state ? FM.ui.state() : null, left: __mp.filter(x => x.e === "mp:left").length})');
    await A.shot(path.join(OUT, 'tur5-lobi-evsahibi.png')); await B.shot(path.join(OUT, 'tur5-lobi-katilan.png'));
    if (sa.code === code && sb.code === code && sa.n === 2 && !sa.R && !sb.R && sa.rd.every(r => !r) && !sa.left && !sb.left && al >= 7 && al <= 10)
      pass(`final (katılanda "lobiye ${al} sn") → ikisi de AYNI odada (${code}) lobide, hazırlar sıfır, menüye atılmadı (arayüz: ${JSON.stringify(sa.ui)} / ${JSON.stringify(sb.ui)})`);
    else fail('lobiye dönüş: ' + JSON.stringify({ sa, sb, al }));
  });

  await step('lobide yeniden yükleme', async () => {
    const cameBefore = (await evs(A, 'net:came')).length;
    await reloadB();
    await waitFor(async () => (await B.eval('FM.net.inRoom() && FM.netgame.state().phase === "lobby"')), 15000, 'katılan lobiye geri döndü');
    await waitFor(async () => (await A.eval('FM.net.players().length')) === 2 && (await A.eval('FM.net.online().length')) === 2, 12000, 'ev sahibi 2 oyuncu + çevrimiçi');
    await sleep(1500);
    const sb = await B.eval('({code: FM.net.code(), rej: __mp.filter(x => x.e === "mp:rejoining").map(x => x.d.code), lobby: __mp.filter(x => x.e === "mp:lobby").length, pid: FM.net.pid(), ui: FM.ui && FM.ui.state ? FM.ui.state() : null})');
    const came = (await evs(A, 'net:came')).length - cameBefore;
    await B.shot(path.join(OUT, 'tur5-yenileme-lobi-katilan.png'));
    if (sb.code === code && sb.rej[0] === code && sb.lobby >= 1 && sb.pid === pidB && came === 0) pass(`lobide sayfa yenilendi → aynı kimlikle (${pidB}) aynı odaya otomatik dönüldü, mp:lobby; ev sahibinde "çevrimiçi oldu" bildirimi YOK (kısa kesinti)`);
    else fail('lobide geri dönüş: ' + JSON.stringify({ sb, came }));
  });

  const errs = A.errs.concat(B.errs);
  if (!errs.length) pass('konsol hatası yok (iki tarayıcı, yeniden yüklemeler dahil)'); else { fail(errs.length + ' konsol hatası'); for (const e of errs.slice(0, 10)) console.log('      ' + e.slice(0, 300)); }
  const caught = (await A.eval('FM.net.log().filter(l => l.indexOf("HATA") >= 0)')).concat(await B.eval('FM.net.log().filter(l => l.indexOf("HATA") >= 0)'));
  if (caught.length) fail('net.js yakalanan hata: ' + caught.slice(0, 3).join(' | '));
  A.close(); B.close();
}
/* ---- TUR6: doğrudan bağlantı (WebRTC) ---- */
// katılan sayfada WebRTC bağlantısı KURULAMASIN (TURN yok + yalnız relay politikası → aday yok, ICE başarısız)
const RTC_BREAK = `(function () { const O = window.RTCPeerConnection; if (!O) return; window.RTCPeerConnection = function (cfg) { return new O(Object.assign({}, cfg || {}, { iceServers: [], iceTransportPolicy: 'relay' })); }; window.RTCPeerConnection.prototype = O.prototype; })();`;
async function p2pFlow(pass, fail) {
  const q = 'dev=1&mobile=1';
  const step = async (name, fn) => { try { await fn(); } catch (e) { fail(name + ' — ' + (e && e.message)); } };
  const A = await openPage('evsahibi', q + '&mp=host&want=99&wait=99999&mode=classic&theme=0&rounds=2&fill=3&mpauto=6');
  await waitFor(() => A.eval('FM.net.inRoom()'), 30000, 'ev sahibi odayı kurdu');
  const code = await A.eval('FM.net.code()');
  let B;
  if (RTCFAIL) {
    // katılan: WebRTC kırık sayfa (betik sayfa betiklerinden önce)
    B = await openPage('katilan', q);
    await B.send('Page.addScriptToEvaluateOnNewDocument', { source: RTC_BREAK });
    await B.send('Page.navigate', { url: pageUrl(q + '&mp=join&room=' + code) });
    await sleep(500);
    await waitFor(() => B.eval('!!(window.FM && FM.netgame && FM.S && FM.S.mode !== "boot" && window.__mp)'), 25000, 'katılan (kırık WebRTC) yüklendi');
  } else B = await openPage('katilan', q + '&mp=join&room=' + code);
  await waitFor(async () => (await B.eval('FM.net.inRoom()')) && (await A.eval('FM.net.players().length')) === 2, 30000, 'katılan odada');
  const pidA = await A.eval('FM.net.pid()'), pidB = await B.eval('FM.net.pid()');
  console.log(`oda ${code} — P2P akışı${RTCFAIL ? ' (katılanda WebRTC kırık)' : ''}; ev sahibi ${pidA}, katılan ${pidB} (teklif eden: ${pidA < pidB ? 'ev sahibi' : 'katılan'})`);
  const link = (P, pid) => P.eval(`(FM.net.players().find(p => p.pid === ${JSON.stringify(pid)}) || {}).link || null`);
  const stats = P => P.eval('FM.net._dbg.rtc.stats()');
  // uzak oyuncunun ekrandaki gecikmesi (ms): gerçek x ile karşı ekrandaki x farkı / hız
  const lagSample = async (from, to, pid) => {
    const [real, seen] = await Promise.all([from.eval('({x: FM.S.player.x, vx: FM.S.player.vx, dead: FM.S.player.dead > 0 || FM.S.player.finished})'), to.eval(`(() => { const r = FM.netgame.racer(${JSON.stringify(pid)}); return r ? {x: r.x} : null; })()`)]);
    if (!real || !seen || real.dead || Math.abs(real.vx) < 200) return null;
    return Math.round((real.x - seen.x) / real.vx * 1000);
  };
  const med = a => { const b = a.filter(v => v != null).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
  const rates = async (P, ms) => { const s0 = await stats(P); await sleep(ms); const s1 = await stats(P); return { dc: Math.round((s1.stDc - s0.stDc) / ms * 10000) / 10, mq: Math.round((s1.stMq - s0.stMq) / ms * 10000) / 10, dup: s1.stDup - s0.stDup, evDup: s1.evDup - s0.evDup }; };

  await step('lobide doğrudan bağlantı', async () => {
    const t0 = Date.now();
    if (RTCFAIL) {
      await sleep(16000);
      const la = await link(A, pidB), lb = await link(B, pidA), sa = await stats(A);
      if (la === 'mqtt' && lb === 'mqtt' && sa.failed >= 1) pass(`katılanda WebRTC kurulamadı → ${Math.round((Date.now() - t0) / 1000)} sn sonra iki tarafta da "mqtt" (deneme başarısız sayıldı: ${sa.failed}, sonra yeniden denenecek)`);
      else fail('kırık WebRTC: ' + JSON.stringify({ la, lb, sa }));
      return;
    }
    await waitFor(async () => (await link(A, pidB)) === 'p2p' && (await link(B, pidA)) === 'p2p', 20000, 'iki yönde p2p');
    await sleep(2500);
    const pa = await A.eval(`FM.net.players().find(p => p.pid === ${JSON.stringify(pidB)})`), st = await A.eval('FM.net.status()');
    pass(`lobide doğrudan bağlantı iki yönde ${((Date.now() - t0) / 1000).toFixed(1)} sn içinde açıldı; ev sahibinde katılan: link=${pa.link}, ping=${pa.ping} ms (aracı ${pa.brokerPing} ms); status: p2p ${st.p2p}/${st.peers}, aracı rtt ${st.brokerRtt} ms`);
  });

  await step('yarış: durum/olay veri kanalından', async () => {
    await A.eval('FM.net.setReady(true)'); await B.eval('FM.net.setReady(true)');
    await waitFor(async () => (await A.eval('FM.netgame.state().phase')) === 'race' && (await B.eval('FM.netgame.state().phase')) === 'race', 15000, 'yarış başladı');
    for (const P of [A, B]) await P.eval('FM.netgame.autopilot = true; if (FM.S.player) FM.S.player.bot = true; true');
    await waitFor(() => B.eval('FM.S.mode === "race" && FM.S.raceT > 3'), 15000, 'yarış ilerledi');
    const [ra, rb] = await Promise.all([rates(A, 4000), rates(B, 4000)]);
    const lags = []; for (let i = 0; i < 12; i++) { lags.push(await lagSample(B, A, pidB)); await sleep(150); }
    const dly = await A.eval(`FM.net.delay(${JSON.stringify(pidB)})`);
    const lag = med(lags);
    console.log('    ara değerleme tahmini (ev sahibinde katılan): ' + await A.eval(`(o => o ? JSON.stringify({iv: Math.round(o.iv), jit: Math.round(o.jit), dly: Math.round(o.dly)}) : '-')(FM.net._dbg.offs[${JSON.stringify(pidB)}])`) + ', kare süresi ' + await A.eval('(() => { const t = []; let l = performance.now(); return new Promise(r => { const f = () => { const n = performance.now(); t.push(n - l); l = n; if (t.length < 30) requestAnimationFrame(f); else r(Math.round(t.reduce((a, b) => a + b) / t.length)); }; requestAnimationFrame(f); }); })()') + ' ms');
    if (RTCFAIL) {
      if (ra.dc === 0 && ra.mq >= 7 && rb.mq >= 7 && lag != null && lag < 400) pass(`WebRTC'siz eş: durum aracıdan (ev sahibi ${ra.mq} Hz, katılan ${rb.mq} Hz), uzak oyuncu ekranda ~${lag} ms geride (ara değerleme ${dly} ms) — oyun sorunsuz`);
      else fail('aracıyla yarış: ' + JSON.stringify({ ra, rb, lag, dly }));
      return;
    }
    if (ra.dc >= 12 && ra.mq <= 1.6 && rb.dc >= 12 && rb.mq <= 1.6 && dly <= 110 && lag != null && lag < 200)
      pass(`durum veri kanalından ~${ra.dc}/${rb.dc} Hz, aracıdan yalnız ${ra.mq}/${rb.mq} Hz yedek (tekrar atılan ${ra.dup + rb.dup}); ara değerleme ${dly} ms, uzak oyuncu ekranda ~${lag} ms geride`);
    else fail('DC akışı: ' + JSON.stringify({ ra, rb, dly, lag, lags }));
    A.lagDc = lag;
    // tekrar atma: katılanın testeresi ev sahibinde TAM BİR KEZ uygulanır (olay iki yoldan gelir)
    await A.eval(`window.__its = 0; FM.on('item:use', d => { if (d.net && d.r && d.r.pid === ${JSON.stringify(pidB)} && d.item === 'saw') __its++; }); true`);
    const e0 = (await stats(A)).evDup;
    let thrown = false;
    for (let i = 0; i < 20 && !thrown; i++) { thrown = await B.eval('(() => { const P = FM.S.player; if (!P || P.dead > 0 || P.finished || P.out || FM.S.mode !== "race") return false; P.item = "saw"; FM.game.useItem(P, 1, 0); return FM.S.ents.some(e => e.type === "saw" && e.o === P); })()'); if (!thrown) await sleep(300); }
    await sleep(1500);
    const its = await A.eval('__its'), e1 = (await stats(A)).evDup;
    if (thrown && its === 1 && e1 > e0) pass(`olay iki yoldan geldi, tekrar atıldı: testere ev sahibinde 1 kez (atılan tekrar ${e1 - e0})`);
    else if (!thrown) console.log('    (testere denemesi atlandı: oyuncu ölü/bitirmiş)');
    else fail('tekrar atma: ' + JSON.stringify({ its, e0, e1 }));
  });

  if (!RTCFAIL) await step('kanal sessizce ölür → aracıya düşüş', async () => {
    await B.eval('FM.net._dbg.rtc.block(true)');
    const t0 = Date.now();
    await waitFor(async () => (await link(A, pidB)) === 'mqtt', 6000, 'ev sahibi aracıya düştü');
    const ms = Date.now() - t0;
    const ra = await rates(A, 3000);
    const lags = []; for (let i = 0; i < 10; i++) { lags.push(await lagSample(B, A, pidB)); await sleep(150); }
    const stale = await A.eval(`(FM.netgame.racer(${JSON.stringify(pidB)}) || {}).stale`);
    if (med(lags) != null && A.lagDc != null && med(lags) - A.lagDc < 25) fail(`doğrudan bağlantı aracıdan belirgin hızlı değil: doğrudan ~${A.lagDc} ms, aracı ~${med(lags)} ms`);
    if (ra.mq >= 7 && ra.dc === 0 && !stale && med(lags) != null && med(lags) < 500) pass(`katılanın kanalı sessizce öldü → ${(ms / 1000).toFixed(1)} sn içinde aracıya düştü, durum aracıdan ${ra.mq} Hz, uzak oyuncu donmadı (ekranda ~${med(lags)} ms geride; doğrudanken ~${A.lagDc} ms)`);
    else fail('düşüş: ' + JSON.stringify({ ra, lags, stale }));
    await B.eval('FM.net._dbg.rtc.block(false)');
    const t1 = Date.now();
    await waitFor(async () => (await link(A, pidB)) === 'p2p' && (await link(B, pidA)) === 'p2p', 45000, 'yeniden p2p').then(() => pass(`kanal geri gelince ${((Date.now() - t1) / 1000).toFixed(1)} sn içinde yeniden doğrudan bağlantı`)).catch(e => fail(e.message));
  });

  if (!RTCFAIL) await step('yarışta yenileme → yeniden P2P', async () => {
    await waitFor(() => B.eval('FM.S.mode === "race"'), 30000, 'yarışta');
    await B.send('Page.navigate', { url: pageUrl(q) });
    await sleep(400);
    await waitFor(() => B.eval('!!(window.FM && FM.netgame && FM.S && FM.S.mode !== "boot" && window.__mp)'), 25000, 'katılan yeniden yüklendi');
    const t0 = Date.now();
    await waitFor(async () => (await B.eval('FM.netgame.state().phase')) !== 'off' && (await link(A, pidB)) === 'p2p' && (await link(B, pidA)) === 'p2p', 20000, 'yeniden p2p');
    await B.eval('FM.netgame.autopilot = true; if (FM.S.player && FM.S.player.ctrl === "local") FM.S.player.bot = true; true');
    pass(`yarışta yenilendi → odaya döndü, doğrudan bağlantı ${((Date.now() - t0) / 1000).toFixed(1)} sn içinde yeniden kuruldu (yeni oturum)`);
  });

  if (!RTCFAIL) await step('ev sahibi donar → göç', async () => {
    await waitFor(async () => (await A.eval('FM.netgame.state().phase')) === 'race' || (await A.eval('FM.netgame.state().round')) === 2, 120000, 'yarış');
    const fr = await A.send('Page.setWebLifecycleState', { state: 'frozen' });
    if (fr.error) throw new Error('dondurma desteklenmedi');
    const t0 = Date.now();
    await waitFor(() => B.eval('FM.net.isHost()'), 15000, 'katılan ev sahibi oldu');
    const ms = Date.now() - t0;
    await sleep(1500);
    await A.send('Page.setWebLifecycleState', { state: 'active' });
    await waitFor(async () => (await A.eval('FM.net.inRoom() && !FM.net.isHost()')) && (await B.eval('FM.net.isHost()')), 20000, 'eski ev sahibi üye oldu');
    await waitFor(async () => (await link(A, pidB)) === 'p2p' && (await link(B, pidA)) === 'p2p', 30000, 'göçten sonra p2p');
    pass(`ev sahibi dondu → ${(ms / 1000).toFixed(1)} sn sonra katılan ev sahibi oldu; eski ev sahibi uyanınca üye, doğrudan bağlantı yine iki yönde`);
  });

  await step('tur sonu herkeste aynı', async () => {
    await waitFor(async () => (await evsOf(A, 'mp:end')).length >= 1 && (await evsOf(B, 'mp:end')).length >= 1, 200000, 'tur sonu');
    const ea = (await evsOf(A, 'mp:end')).map(x => endSig(x.d)), eb = (await evsOf(B, 'mp:end')).map(x => endSig(x.d));
    const last = ea[ea.length - 1];
    if (eb.indexOf(last) >= 0) pass('tur sonucu iki tarafta aynı'); else fail('sonuç farklı: ' + ea.join(' | ') + ' // ' + eb.join(' | '));
  });

  const errs = A.errs.concat(B.errs);
  if (!errs.length) pass('konsol hatası yok'); else { fail(errs.length + ' konsol hatası'); for (const e of errs.slice(0, 10)) console.log('      ' + e.slice(0, 300)); }
  const caught = (await A.eval('FM.net.log().filter(l => l.indexOf("HATA") >= 0)')).concat(await B.eval('FM.net.log().filter(l => l.indexOf("HATA") >= 0)'));
  if (caught.length) fail('net.js yakalanan hata: ' + caught.slice(0, 3).join(' | '));
  console.log('    ev sahibi bağlantı günlüğü: ' + (await A.eval('FM.net.log().filter(l => /doğrudan|aracı yoklaması/.test(l)).slice(-8).join(" | ")')));
  console.log('    katılan  bağlantı günlüğü: ' + (await B.eval('FM.net.log().filter(l => /doğrudan/.test(l)).slice(-8).join(" | ")')));
  A.close(); B.close();
}
const evsOf = (P, e) => P.eval('__mp.filter(x => x.e === ' + JSON.stringify(e) + ')');
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
    if (process.argv.includes('--yerel') && !BURL) { LOCAL = await require('./broker.js').start({ port: 0 }); BURL = LOCAL.url; console.log('Yerel aracı: ' + BURL); }
    if (BURL) setBroker(BURL);
    main: {
    if (TUR5) { await tur5Flow(pass, fail); break main; }
    if (P2P) { await p2pFlow(pass, fail); break main; }
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
  if (LOCAL) LOCAL.close();
  setTimeout(() => process.exit(bad.length ? 1 : 0), 1200);
})();
