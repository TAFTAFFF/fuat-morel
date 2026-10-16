// Kullanım: node dev/mp-ui.js [çıktı klasörü] [--rounds=1] [--mode=classic]
// ARAYÜZ uçtan uca testi: İKİ headless Chrome (--mute-audio), geliştirici kancası OLMADAN (mp=... yok) gerçek düğmelere tıklayarak:
//   A: Ana menü → ARKADAŞLARLA → ODA KUR → takma ad penceresi → lobi; link = FM.net.shareLink()
//   B: link (?oda=KOD) ile açılır → otomatik katılma → takma ad → lobi → karakter değiştir → HAZIRIM
//   A: ayarlar (mod, tur) → BAŞLAT → yarış (otomatik pilot) → emoji, ağ menüsü → sonuç (B'de "Ev sahibi bekleniyor") → FİNAL → LOBİYE DÖN
//   B: ODADAN AYRIL. Konsol hatası olmamalı; ekran görüntüleri klasöre.
// YAVAŞ MOD: en fazla 2 Chrome; bitince kapatılır.
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { sleep, waitFor } = require('./mp-bots.js');
const root = path.resolve(__dirname, '..');
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (!chromePath) { console.error('Chrome/Edge bulunamadı'); process.exit(1); }
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };
const OUT = path.resolve(ARGS[0] || path.join(os.tmpdir(), 'fm-mp-ui'));
const ROUNDS = [1, 3, 5].indexOf(+opt('rounds')) >= 0 ? +opt('rounds') : 1, MODE = opt('mode') || 'classic';
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
  const profile = path.join(os.tmpdir(), 'fm-mpui-' + name + '-' + process.pid);
  const url = 'file:///' + root.split(path.sep).join('/') + '/index.html?' + query;
  const ch = spawn(chromePath, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-allow-origins=*',
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
    // A: ayarlar (tur, mod)
    await tap(A, `[data-act="lcfg"][data-k="rounds"][data-v="${ROUNDS === 1 ? 1 : ROUNDS}"]`, 'A tur');
    if (MODE !== 'classic') {
      for (let i = 0; i < 5 && (await A.eval('FM.net.lobby().cfg.mode')) !== MODE; i++) await tap(A, '[data-act="lcfg"][data-k="mode"][data-d="1"]', 'A mod ileri');
    }
    await waitFor(() => B.eval(`FM.net.lobby().cfg.rounds === ${ROUNDS} && FM.net.lobby().cfg.mode === ${JSON.stringify(MODE)}`), 8000, 'B ayarları görüyor');
    ok(true, 'oda ayarları karşıya geçti (' + MODE + ', ' + ROUNDS + ' tur)');
    // emoji (lobi)
    await tap(B, '[data-act="lbemo"]', 'B emoji paneli');
    await tap(B, '.lb-emo .emo-b[data-e="👍"]', 'B 👍');
    await waitFor(() => A.eval('__ev.includes("mp:emote")'), 6000, 'A emoji aldı');
    await sleep(300);
    await A.shot(path.join(OUT, 'a-lobby.png')); await B.shot(path.join(OUT, 'b-lobby.png'));
    ok(true, 'lobide emoji karşıya geçti');
    // ---------- yarış ----------
    await A.eval('FM.netgame.autopilot = true'); await B.eval('FM.netgame.autopilot = true');
    await tap(A, '[data-act="lbstart"]', 'A BAŞLAT');
    await waitFor(async () => (await ui(A)).view === 'race' && (await ui(B)).view === 'race', 15000, 'iki taraf yarışta');
    ok(true, 'BAŞLAT → iki taraf yarışta');
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
    const rb = await B.eval('({wait: !!document.querySelector(".res-foot .btn-next.wait"), me: document.querySelectorAll(".res-tbl .rr.me").length})');
    ok(ra.next && ra.me === 1, 'A sonuç: SONRAKİ/FİNAL düğmesi, tek "SEN" satırı');
    ok(rb.wait && rb.me === 1, 'B sonuç: "Ev sahibi bekleniyor", tek "SEN" satırı');
    await A.shot(path.join(OUT, 'a-results.png')); await B.shot(path.join(OUT, 'b-results.png'));
    for (let r = 1; r < ROUNDS; r++) {
      await tap(A, '.res-foot [data-act="next"]', 'A SONRAKİ TUR');
      await waitFor(async () => (await ui(A)).view === 'race' && (await ui(B)).view === 'race', 15000, 'tur ' + (r + 1) + ' başladı');
      await waitFor(async () => (await ui(A)).view === 'results' && (await ui(B)).view === 'results', 150000, 'tur ' + (r + 1) + ' sonucu');
      await sleep(1200);
    }
    await tap(A, '.res-foot [data-act="next"]', 'A FİNAL');
    await waitFor(async () => (await ui(A)).view === 'final' && (await ui(B)).view === 'final', 15000, 'iki tarafta final');
    await sleep(1500);
    const fa = await A.eval('({lob: !!document.querySelector("[data-act=\\"tolobby\\"]"), me: document.querySelectorAll(".fin-rows .fr.me").length})');
    const fb = await B.eval('({wait: !!document.querySelector(".fin-btns .wait"), me: document.querySelectorAll(".fin-rows .fr.me").length})');
    ok(fa.lob && fa.me === 1, 'A final: LOBİYE DÖN, tek "SEN"');
    ok(fb.wait && fb.me === 1, 'B final: ev sahibi bekleniyor, tek "SEN"');
    await A.shot(path.join(OUT, 'a-final.png')); await B.shot(path.join(OUT, 'b-final.png'));
    await tap(A, '[data-act="tolobby"]', 'A LOBİYE DÖN');
    await waitFor(async () => (await ui(A)).screen === 'lobby' && (await ui(B)).screen === 'lobby', 15000, 'iki taraf lobiye döndü');
    ok(true, 'lobiye dönüş');
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
  setTimeout(() => process.exit(fails ? 1 : 0), 1200);
})();
