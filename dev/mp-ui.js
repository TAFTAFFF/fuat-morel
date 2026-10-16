// Kullanım: node dev/mp-ui.js [çıktı klasörü] [--rounds=1] [--mode=classic] [--broker=ws://127.0.0.1:1884/mqtt]
// ARAYÜZ uçtan uca testi: İKİ headless Chrome (--mute-audio), geliştirici kancası OLMADAN (mp=... yok) gerçek düğmelere tıklayarak:
//   A: Ana menü → ARKADAŞLARLA → ODA KUR → takma ad penceresi → lobi; link = FM.net.shareLink()
//   B: link (?oda=KOD) ile açılır → otomatik katılma → takma ad → lobi → karakter değiştir → HAZIRIM
//   A: ayarlar (mod, tur) → HAZIRIM (ev sahibi de) → "Herkes hazır! 5…" geri sayımı (iptal/yeniden dene) → yarış KENDİLİĞİNDEN başlar
//      (FM.netgame.countdown yoksa HEMEN BAŞLAT ile devam eder) → ağ menüsü (duraklamaz) → emoji → sonuç ("Sonraki tur N…" herkeste)
//      → final → herkes KENDİLİĞİNDEN lobiye döner (hazırlar sıfır) → B sayfayı yeniler → "ODAYA GERİ DÖN" / otomatik geri dönüş → B ayrılır.
// Aracı: --broker verilmezse dev/broker.js yerel aracı başlatılır ve sayfalara ?brokerUrl= ile verilir (bu bulut ortamı herkese açık aracılara bağlanamaz).
// Konsol hatası olmamalı; ekran görüntüleri klasöre. YAVAŞ MOD: en fazla 2 Chrome; bitince kapatılır.
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { sleep, waitFor } = require('./mp-bots.js');
const root = path.resolve(__dirname, '..');
const chromePath = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && fs.existsSync(p));
if (!chromePath) { console.error('Chrome/Edge bulunamadı'); process.exit(1); }
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const OUT = path.resolve(ARGS[0] || path.join(os.tmpdir(), 'fm-mp-ui'));
const ROUNDS = [1, 3, 5].indexOf(+opt('rounds')) >= 0 ? +opt('rounds') : 1, MODE = opt('mode') || 'classic';
let BROKER = opt('broker') || '', LOCAL = null;   // yerel aracı (dev/broker.js)
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
function killAll() {
  for (const p of procs) { try { p.ch.kill(); } catch (e) { } }
  setTimeout(() => { for (const p of procs) { try { fs.rmSync(p.profile, { recursive: true, force: true }); } catch (e) { } } }, 800);
}
process.on('exit', killAll);
async function openPage(name, query) {
  if (BROKER) query += '&brokerUrl=' + encodeURIComponent(BROKER);
  const profile = path.join(os.tmpdir(), 'fm-mpui-' + name + '-' + process.pid);
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
  // gerçek telefon görüntü alanı: headless pencerede tarayıcı çubuğu ~190 px yer kaplar → 844×390 görüntü alanını zorla
  await page.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => page.eval('!!(window.FM && FM.ui && FM.ui.state && FM.netgame && FM.S && FM.S.mode !== "boot")'), 25000, name + ' oyun yüklendi');
  await page.eval('window.__ev = []; for (const e of ["mp:start","mp:end","mp:final","mp:lobby","mp:emote","net:error","mp:left"]) FM.on(e, d => __ev.push(e)); true');
  page.name = name;
  return page;
}
// gerçek fare tıklaması (öğenin ortası) — data-act düğmeleri
async function tap(page, sel, what) {
  await waitFor(() => page.eval(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; })()`), 15000, page.name + ': ' + (what || sel));
  await sleep(380);   // giriş animasyonu
  const r = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await sleep(150);
}
async function typeIn(page, sel, text) {
  await page.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ''; return true; })()`);
  await page.send('Input.insertText', { text });
}
const ui = p => p.eval('FM.ui.state()');

(async () => {
  let fails = 0;
  const ok = (c, m) => { console.log((c ? 'TAMAM ' : 'HATA  ') + m); if (!c) fails++; };
  try {
    if (!BROKER) {
      try { LOCAL = await require('./broker.js').start({ port: 18840 + Math.floor(Math.random() * 100) }); BROKER = LOCAL.url; console.log('yerel aracı: ' + BROKER); }
      catch (e) { console.log('yerel aracı başlatılamadı (' + e.message + '): herkese açık aracılar denenecek'); }
    }
    // ---------- A: oda kur ----------
    const A = await openPage('evsahibi', 'dev=1&scene=menu&run=1&mobile=1');
    await waitFor(async () => (await ui(A)).screen === 'menu', 15000, 'A ana menü');
    await tap(A, '.btn-friends', 'ARKADAŞLARLA');
    await waitFor(async () => (await ui(A)).screen === 'friends', 5000, 'A arkadaşlarla ekranı');
    await tap(A, '[data-act="mpcreate"]', 'ODA KUR');
    await waitFor(async () => (await ui(A)).modal === 'nick', 5000, 'A takma ad penceresi');
    await A.shot(path.join(OUT, 'a-nick.png'));
    await typeIn(A, '.nk-in', 'Emir');
    await tap(A, '[data-act="nickok"]', 'TAMAM');
    await waitFor(async () => (await ui(A)).screen === 'lobby', 30000, 'A lobi');
    const code = await A.eval('FM.net.code()');
    const link = await A.eval('FM.net.shareLink()');
    ok(/^[A-Z2-9]{5}$/.test(code) && link.indexOf('?oda=' + code) > 0, 'oda kuruldu: ' + code + ' link ' + link);
    ok((await A.eval('FM.net.nick()')) === 'Emir', 'takma ad kaydedildi (Emir)');
    // ---------- B: linkle katıl ----------
    const B = await openPage('katilan', 'dev=1&scene=menu&run=1&mobile=1&oda=' + code);
    await waitFor(async () => (await ui(B)).modal === 'nick', 15000, 'B takma ad penceresi (linkle açılış)');
    await typeIn(B, '.nk-in', 'Caner');
    await tap(B, '[data-act="nickok"]', 'B TAMAM');
    await waitFor(async () => (await ui(B)).screen === 'lobby', 30000, 'B lobi');
    await waitFor(() => A.eval('FM.net.players().length === 2'), 10000, 'A 2 oyuncu görüyor');
    ok(true, 'B linkle katıldı, iki lobide 2 oyuncu');
    // B karakter değiştir + hazır
    await tap(B, '[data-act="chpick"]', 'B karakter');
    await tap(B, '.cpk[data-id="Kral"]', 'B Kral');
    await waitFor(() => A.eval('(FM.net.players().find(p => !p.me) || {}).char === "Kral"'), 8000, 'A, B\'nin karakterini Kral görüyor');
    ok(true, 'lobide karakter değişimi karşıya geçti');
    await tap(B, '[data-act="lbready"]', 'B HAZIRIM');
    await waitFor(() => A.eval('!!(FM.net.players().find(p => !p.me) || {}).ready'), 8000, 'A, B\'yi hazır görüyor');
    await waitFor(() => A.eval('document.querySelectorAll(".lb-pl-in .pc.rdy").length >= 1'), 5000, 'A lobi listesinde HAZIR');
    ok(true, 'HAZIRIM karşıya geçti');
    ok(await A.eval('!!document.querySelector("[data-act=\\"lbready\\"]") && !!document.querySelector("[data-act=\\"lbstart\\"]")'), 'ev sahibinde de HAZIRIM + HEMEN BAŞLAT düğmesi var');
    // A: ayarlar (tur, mod)
    await tap(A, `[data-act="lcfg"][data-k="rounds"][data-v="${ROUNDS === 1 ? 1 : ROUNDS}"]`, 'A tur');
    if (MODE !== 'classic') {
      for (let i = 0; i < 5 && (await A.eval('FM.net.lobby().cfg.mode')) !== MODE; i++) await tap(A, '[data-act="lcfg"][data-k="mode"][data-d="1"]', 'A mod ileri');
    }
    try { await waitFor(() => B.eval(`FM.net.lobby().cfg.rounds === ${ROUNDS} && FM.net.lobby().cfg.mode === ${JSON.stringify(MODE)}`), 8000, 'B ayarları görüyor'); }
    catch (e) { console.log('teşhis: A cfg ' + (await A.eval('JSON.stringify(FM.net.lobby().cfg)')) + ' | B cfg ' + (await B.eval('JSON.stringify(FM.net.lobby().cfg)'))); await A.shot(path.join(OUT, 'a-cfgfail.png')); throw e; }
    ok(true, 'oda ayarları karşıya geçti (' + MODE + ', ' + ROUNDS + ' tur)');
    // emoji (lobi)
    await tap(B, '[data-act="lbemo"]', 'B emoji paneli');
    await tap(B, '.lb-emo .emo-b[data-e="👍"]', 'B 👍');
    await waitFor(() => A.eval('__ev.includes("mp:emote")'), 6000, 'A emoji aldı');
    await sleep(300);
    await A.shot(path.join(OUT, 'a-lobby.png')); await B.shot(path.join(OUT, 'b-lobby.png'));
    ok(true, 'lobide emoji karşıya geçti');
    // ---------- herkes hazır → geri sayım → yarış kendiliğinden ----------
    await A.eval('FM.netgame.autopilot = true'); await B.eval('FM.netgame.autopilot = true');
    const hasCd = await A.eval('typeof FM.netgame.countdown === "function"');
    if (hasCd) {
      await tap(A, '[data-act="lbready"]', 'A HAZIRIM (ev sahibi)');
      await waitFor(() => B.eval('!!document.querySelector(".lb-cd .cd-n")'), 10000, 'B geri sayım afişi');
      await B.shot(path.join(OUT, 'b-countdown.png')); await A.shot(path.join(OUT, 'a-countdown.png'));
      ok(true, 'herkes hazır → geri sayım afişi iki lobide de görünüyor');
      // iptal: B hazırı geri alır
      await tap(B, '[data-act="lbready"]', 'B hazırı geri al');
      await waitFor(() => A.eval('!document.querySelector(".lb-cd .cd-n")'), 6000, 'A geri sayım iptal oldu');
      await waitFor(() => A.eval('!!document.querySelector(".lb-cd .cd-x")'), 3000, 'A iptal nedeni afişi');
      ok(true, 'hazırı geri alınca geri sayım iptal oldu, neden gösterildi');
      await tap(B, '[data-act="lbready"]', 'B yeniden HAZIRIM');
      await waitFor(async () => (await ui(A)).view === 'race' && (await ui(B)).view === 'race', 25000, 'geri sayım bitince iki taraf kendiliğinden yarışta');
      ok(true, 'geri sayım → yarış KENDİLİĞİNDEN başladı');
    } else {
      console.log('NOT  FM.netgame.countdown yok (AĞ ajanı bekleniyor): HEMEN BAŞLAT ile devam');
      await tap(A, '[data-act="lbstart"]', 'A HEMEN BAŞLAT');
      await waitFor(async () => (await ui(A)).view === 'race' && (await ui(B)).view === 'race', 15000, 'iki taraf yarışta');
      ok(true, 'HEMEN BAŞLAT → iki taraf yarışta');
    }
    await sleep(5500);
    // ağ menüsü: duraklatma yok
    await A.eval('FM.emit("ui:pause", {toggle: true})');
    const pz = await A.eval('({m: FM.ui.state().modal, p: !!FM.S.paused, t: (document.querySelector(".pz-mp .q-t") || {}).textContent})');
    ok(pz.m === 'pause' && !pz.p && pz.t === 'ODADAN AYRIL', 'ağ menüsü açıldı, oyun duraklamadı (' + JSON.stringify(pz) + ')');
    await A.shot(path.join(OUT, 'a-mpmenu.png'));
    await tap(A, '[data-act="resume"]', 'A YARIŞA DÖN');
    // yarış içi emoji (dokunmatik düzende düğme görünür)
    await tap(B, '.emo-btn', 'B yarış emoji düğmesi');
    await B.shot(path.join(OUT, 'b-race-emo.png'));
    await tap(B, '.emo-race .emo-b[data-e="😂"]', 'B 😂');
    await waitFor(() => A.eval('__ev.filter(e => e === "mp:emote").length >= 2'), 6000, 'A yarışta emoji aldı');
    ok(true, 'yarışta emoji karşıya geçti');
    await A.shot(path.join(OUT, 'a-race.png'));
    // ---------- sonuç ----------
    await waitFor(async () => (await ui(A)).view === 'results' && (await ui(B)).view === 'results', 150000, 'iki tarafta sonuç');
    await sleep(1500);
    const ra = await A.eval('({next: !!document.querySelector(".res-foot [data-act=\\"next\\"]"), me: document.querySelectorAll(".res-tbl .rr.me").length})');
    const rb = await B.eval('({wait: !!document.querySelector(".res-foot .btn-next.wait"), txt: (document.querySelector(".res-foot .btn-next") || {}).textContent, me: document.querySelectorAll(".res-tbl .rr.me").length})');
    ok(ra.next && ra.me === 1, 'A sonuç: SONRAKİ/FİNAL düğmesi, tek "SEN" satırı');
    ok(rb.wait && rb.me === 1, 'B sonuç: "' + String(rb.txt || '').trim() + '" (sonraki tur sayacı / ev sahibi bekleniyor), tek "SEN" satırı');
    await A.shot(path.join(OUT, 'a-results.png')); await B.shot(path.join(OUT, 'b-results.png'));
    // tur / final ilerlemesi: otomatik (FM.netgame.autoLeft) ya da elle (düğme). Otomatik çalışıyorsa düğmeye BASILMAZ.
    const autoOn = await A.eval('typeof FM.netgame.autoLeft === "function" && FM.netgame.autoLeft() != null');
    const bothView = async v => (await ui(A)).view === v && (await ui(B)).view === v;
    const advance = async (want, sel, label) => {
      const t0 = Date.now();
      while (autoOn && Date.now() - t0 < 16000) { if (await bothView(want)) return 'otomatik'; await sleep(300); }
      if (await bothView(want)) return 'otomatik';
      await tap(A, sel, label);
      await waitFor(() => bothView(want), 15000, label + ' sonrası ' + want);
      return 'elle';
    };
    for (let r = 1; r < ROUNDS; r++) {
      const how = await advance('race', '.res-foot [data-act="next"]', 'A SONRAKİ TUR');
      ok(true, 'tur ' + (r + 1) + ' başladı (' + how + ')');
      await waitFor(() => bothView('results'), 150000, 'tur ' + (r + 1) + ' sonucu');
      await sleep(1200);
    }
    const hf = await advance('final', '.res-foot [data-act="next"]', 'A FİNAL');
    ok(true, 'iki tarafta final (' + hf + ')');
    await sleep(1200);
    const fa = await A.eval('({lob: !!document.querySelector("[data-act=\\"tolobby\\"]"), me: document.querySelectorAll(".fin-rows .fr.me").length, aw: document.querySelectorAll(".fin .fa").length})');
    const fb = await B.eval('({wait: !!document.querySelector(".fin-btns .wait"), txt: (document.querySelector(".fin-btns .wait") || {}).textContent, me: document.querySelectorAll(".fin-rows .fr.me").length})');
    ok(fa.lob && fa.me === 1, 'A final: LOBİYE DÖN, tek "SEN" (eğlenceli ödül kartı: ' + fa.aw + ')');
    ok(fb.wait && fb.me === 1, 'B final: "' + String(fb.txt || '').trim() + '", tek "SEN"');
    await A.shot(path.join(OUT, 'a-final.png')); await B.shot(path.join(OUT, 'b-final.png'));
    // maç sonu: herkes KENDİLİĞİNDEN lobiye döner (menüye atılmaz); olmazsa ev sahibi düğmesi
    let back = 'otomatik';
    const t1 = Date.now();
    // ui.state().screen yarış/sonuç/final GÖRÜNÜMLERİNDE de 'lobby' kalır: gerçek dönüşü ağ evresi söyler
    const inLobby = async p => (await ui(p)).screen === 'lobby' && (await p.eval('FM.netgame.state().phase')) === 'lobby';
    while (autoOn && Date.now() - t1 < 30000) { if (await inLobby(A) && await inLobby(B)) break; await sleep(400); }
    if (!(await inLobby(A) && await inLobby(B))) { back = 'elle'; await tap(A, '[data-act="tolobby"]', 'A LOBİYE DÖN'); }
    await waitFor(async () => await inLobby(A) && await inLobby(B), 15000, 'iki taraf lobiye döndü');
    ok(true, 'lobiye dönüş (' + back + ')');
    await sleep(800);
    console.log('teşhis hazır bayrakları: A R.ready=' + (await A.eval('FM.net._dbg.R.ready')) + ' B R.ready=' + (await B.eval('FM.net._dbg.R.ready')) + ' A lobi rd=' + (await A.eval('JSON.stringify(FM.net._dbg.R.lob.p.map(p=>[p.id.slice(0,4),p.rd]))')) + ' cd=' + (await A.eval('FM.netgame.countdown()')));
    const rdyNow = await A.eval('JSON.stringify(FM.net.players().map(p => [p.nick, !!p.ready, !!p.off]))');
    ok(await A.eval('FM.net.players().every(p => !p.ready || p.off)'), 'lobiye dönünce hazırlar sıfırlandı ' + rdyNow);
    await A.shot(path.join(OUT, 'a-lobby2.png'));
    // ---------- B sayfayı yeniler: odaya geri dön ----------
    if (await B.eval('typeof FM.netgame.rejoin === "function" && typeof FM.netgame.rejoinInfo === "function"')) {   // (odadayken rejoinInfo() null döner; yenileyince dolar)
      await B.send('Page.navigate', { url: 'file:///' + root.split(path.sep).join('/') + '/index.html?dev=1&scene=menu&run=1&mobile=1' + (BROKER ? '&brokerUrl=' + encodeURIComponent(BROKER) : '') });
      await sleep(1500);
      await waitFor(() => B.eval('!!(window.FM && FM.ui && FM.ui.state && FM.S && FM.S.mode !== "boot")'), 25000, 'B yeniden yüklendi');
      let auto = false;
      for (let i = 0; i < 24; i++) {
        if ((await ui(B)).screen === 'lobby') { auto = true; break; }
        if (await B.eval('!!document.querySelector("[data-act=\\"rejoin\\"]")')) break;
        await sleep(500);
      }
      await B.shot(path.join(OUT, 'b-reload.png'));
      if (!auto) await tap(B, '[data-act="rejoin"]', 'B ODAYA GERİ DÖN');
      await waitFor(async () => (await ui(B)).screen === 'lobby', 30000, 'B odaya geri döndü');
      await waitFor(() => A.eval('FM.net.players().filter(p => !p.off).length === 2'), 15000, 'A, B\'yi yine odada görüyor');
      ok(true, 'sayfa yenilendi → odaya geri dönüldü (' + (auto ? 'otomatik' : 'ODAYA GERİ DÖN düğmesiyle') + ')');
    } else console.log('NOT  FM.netgame.rejoin/rejoinInfo yok (AĞ ajanı bekleniyor): geri dönüş testi atlandı');
    // ---------- B ayrılır ----------
    await tap(B, '[data-act="lbleave"]', 'B AYRIL');
    await tap(B, '[data-act="mok"]', 'B onay');
    await waitFor(async () => (await ui(B)).screen === 'menu', 8000, 'B ana menü');
    await waitFor(() => A.eval('FM.net.players().filter(p => !p.off).length === 1'), 12000, 'A tek kaldı');
    ok(true, 'B ayrıldı, A lobide tek');
    await sleep(500);
    ok(!A.errs.length, 'A konsol hatası yok' + (A.errs.length ? ': ' + A.errs.slice(0, 5).join(' | ') : ''));
    ok(!B.errs.length, 'B konsol hatası yok' + (B.errs.length ? ': ' + B.errs.slice(0, 5).join(' | ') : ''));
    await A.eval('FM.netgame.leave()');
  } catch (e) {
    fails++;
    console.log('HATA  ' + e.message);
  }
  console.log(fails ? 'SONUÇ: ' + fails + ' HATA' : 'SONUÇ: HEPSİ GEÇTİ', '— görüntüler: ' + OUT);
  killAll();
  if (LOCAL) { try { await LOCAL.close(); } catch (e) { } }
  setTimeout(() => process.exit(fails ? 1 : 0), 1200);
})();
