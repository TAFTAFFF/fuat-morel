// Kullanım: node dev/net-browser.js [aracı 0|1|2] [--yerel]   (varsayılan: tercih edilen ilk aracı)
//   --yerel: dev/broker.js yerel aracısını başlatır; sayfa ?brokerUrl= ile, node oyuncular da ona bağlanır (NET_BROKER=ws://.../mqtt de olur).
// GERÇEK oyunu (index.html) tek bir headless Chrome'da açar (DevTools protokolü), sayfayı EV SAHİBİ yapar; node'da 2 sahte oyuncu
// (js/core.js + js/net.js, vm) katılır. Dener: tarayıcı WebSocket yolu, kayıtta pid, lobi, start, iki yönlü durum akışı + olaylar,
// sayfa DONDURMA (telefon arka plana atıldı: Page.setWebLifecycleState frozen) → ev sahibi göçü → geri dönüş, toLobby,
// ?oda=KOD linki, konsol hataları. Hafif: 1 Chrome (--mute-audio) + 1 node süreci, iş bitince Chrome kapatılır.
'use strict';
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const coreSrc = fs.readFileSync(path.join(root, 'js', 'core.js'), 'utf8');
const netSrc = fs.readFileSync(path.join(root, 'js', 'net.js'), 'utf8');
const chromePath = [process.env.CHROME, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => p && fs.existsSync(p));
if (!chromePath) { console.error('Chrome/Edge bulunamadı'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
let BURL = process.env.NET_BROKER || null;
function waitFor(fn, ms, what) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const loop = async () => { let ok = false; try { ok = await fn(); } catch (e) { } if (ok) return res(Date.now() - t0); if (Date.now() - t0 > ms) return rej(new Error('zaman aşımı: ' + what)); setTimeout(loop, 120); };
    loop();
  });
}

/* ---- node sahte oyuncu ---- */
function client(name) {
  const store = {};
  const sb = { console, Math, Date, JSON, setTimeout, clearTimeout, setInterval, clearInterval, performance, crypto: globalThis.crypto, TextEncoder, TextDecoder, WebSocket, URL, URLSearchParams,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    location: { search: BURL ? '?brokerUrl=' + encodeURIComponent(BURL) : '', href: 'https://ornek.github.io/fuat-morel/index.html' }, navigator: { maxTouchPoints: 0, onLine: true }, history: { replaceState() { } },
    document: { hidden: false, addEventListener() { } }, addEventListener() { } };
  sb.window = sb; vm.createContext(sb);
  vm.runInContext(coreSrc, sb, { filename: 'core.js' }); vm.runInContext(netSrc, sb, { filename: 'net.js' });
  const c = { name, FM: sb.FM, net: sb.FM.net, ev: [] };
  for (const e of ['net:start', 'net:toLobby', 'net:event', 'net:host', 'net:error', 'net:emoji']) sb.FM.on(e, d => c.ev.push({ e, d }));
  return c;
}
const last = (c, e) => { for (let i = c.ev.length - 1; i >= 0; i--) if (c.ev[i].e === e) return c.ev[i]; return null; };

/* ---- minimal DevTools istemcisi ---- */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const cb = {}; const hs = [];
  const api = {
    ready: new Promise((res, rej) => { ws.onopen = res; ws.onerror = e => rej(new Error('CDP bağlanamadı')); }),
    on: h => hs.push(h),
    send: (method, params) => new Promise(res => { const i = ++id; cb[i] = res; ws.send(JSON.stringify({ id: i, method, params: params || {} })); }),
    eval: async expr => {
      const r = await api.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.error) throw new Error(r.error.message);
      if (r.result.exceptionDetails) throw new Error('sayfa: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text));
      return r.result.result.value;
    },
    close: () => { try { ws.close(); } catch (e) { } }
  };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.id && cb[m.id]) { cb[m.id](m); delete cb[m.id]; } else if (m.method) for (const h of hs) h(m); };
  return api;
}

(async () => {
  let broker = null;
  if (process.argv.includes('--yerel') && !BURL) { broker = await require('./broker.js').start({ port: 0 }); BURL = broker.url; console.log('Yerel aracı: ' + BURL); }
  const profile = path.join(os.tmpdir(), 'fm-netb-' + process.pid);
  const url = 'file:///' + root.split(path.sep).join('/') + '/index.html?mobile=1' + (BURL ? '&pres=0&brokerUrl=' + encodeURIComponent(BURL) : '');
  const ch = spawn(chromePath, ['--headless=new', ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), '--disable-gpu', '--mute-audio', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-allow-origins=*',
    '--user-data-dir=' + profile, '--window-size=844,390', url], { stdio: 'ignore' });
  const killChrome = () => { try { ch.kill(); } catch (e) { } };
  process.on('exit', killChrome);
  const ok = [], bad = [], errs = [];
  const pass = m => { ok.push(m); console.log('  ✓ ' + m); };
  const fail = m => { bad.push(m); console.log('  ✗ ' + m); };
  let page = null; const nodes = [];
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    await waitFor(() => fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0], 15000, 'Chrome hata ayıklama portu');
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
    let target = null;
    await waitFor(async () => { const l = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = l.find(t => t.type === 'page' && t.url.indexOf('index.html') >= 0); return !!target; }, 15000, 'sayfa hedefi');
    page = cdp(target.webSocketDebuggerUrl); await page.ready;
    page.on(m => {
      if (m.method === 'Runtime.exceptionThrown') errs.push('istisna: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text));
      if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) errs.push('console.' + m.params.type + ': ' + m.params.args.map(a => a.value || a.description || '').join(' '));
    });
    await page.send('Runtime.enable'); await page.send('Page.enable');
    await waitFor(() => page.eval('!!(window.FM && FM.net && FM.S && FM.S.mode !== "boot")'), 20000, 'oyun yüklendi');
    const bi = process.argv[2] != null && /^\d$/.test(process.argv[2]) ? +process.argv[2] : await page.eval('FM.net.PREF[0]');
    console.log('=== Tarayıcı ev sahibi, aracı ' + bi + ' ===');

    // kimlik kayıtta
    await sleep(600);
    const idInfo = await page.eval('({pid: FM.net.pid(), saved: (JSON.parse(localStorage.getItem("fuatmorel_save_v2") || "{}")).pid, nick: FM.save.nick, nickSet: FM.save.nickSet, mode: FM.S.mode})');
    if (idInfo.pid && idInfo.pid === idInfo.saved && typeof idInfo.nick === 'string' && idInfo.nickSet === false) pass('pid kayıtta kalıcı (' + idInfo.pid + '), takma ad varsayılanı "' + idInfo.nick + '", nickSet=false; oyun modu ' + idInfo.mode);
    else fail('kimlik: ' + JSON.stringify(idInfo));

    await page.eval('window.__ev = []; for (const e of ["net:status","net:lobby","net:start","net:toLobby","net:event","net:host","net:error","net:emoji"]) FM.on(e, d => __ev.push({e, d: JSON.parse(JSON.stringify(d))})); true');
    await page.eval('FM.net.createRoom({broker: ' + bi + ', cfg: {mode: "classic"}})');
    await waitFor(() => page.eval('FM.net.inRoom()'), 30000, 'tarayıcı odayı kurdu');
    const code = await page.eval('FM.net.code()');
    const link = await page.eval('FM.net.shareLink()');
    if (/index\.html\?oda=[A-Z2-9]{5}$/.test(link) && link.indexOf('mobile=1') < 0) pass('oda ' + code + ' kuruldu, paylaşım linki ' + link); else fail('link: ' + link);

    const B = client('B'), Cc = client('C'); nodes.push(B, Cc);
    B.net.joinRoom(code); Cc.net.joinRoom(code);
    await waitFor(async () => B.net.inRoom() && Cc.net.inRoom() && (await page.eval('FM.net.players().length')) === 3, 40000, 'iki node oyuncu katıldı');
    pass('2 node oyuncu tarayıcının odasına katıldı; tarayıcı 3 oyuncu görüyor');

    // boş kadro: sayfadaki netgame bu yükle GERÇEK yarış başlatmaz (yoksa oyunun kendi durum akışı testin akışıyla yarışır)
    await page.eval('FM.net.start({seed: 99, theme: 1, mode: "classic", round: 1, rounds: 3, roster: [], pids: FM.net.players().map(p => p.pid)})');
    await waitFor(() => last(B, 'net:start') && last(Cc, 'net:start'), 8000, 'net:start node oyunculara');
    await waitFor(() => page.eval('__ev.some(x => x.e === "net:start")'), 5000, 'net:start tarayıcının kendisine');
    pass('tarayıcı ev sahibinin start mesajı herkese ulaştı (kendisine de yankıyla)');

    // iki yönlü durum akışı
    await page.eval('window.__st = setInterval(() => FM.net.sendState(FM.net.packRacer({x: 100 + performance.now() * 0.3, y: 400, vx: 300, vy: 0, h: 42, face: 1, onGround: true, item: "dyn"})), 16); true');
    const t0 = performance.now();
    const niv = setInterval(() => { for (const c of [B, Cc]) c.net.sendState(c.net.packRacer({ x: 100 + (performance.now() - t0) * 0.3, y: 380, vx: 300, vy: 0, h: 42, face: 1, onGround: true })); }, 16);
    let browserStates = 0, lastSeenObj = null;
    const ciw = setInterval(() => { const b = B.net._dbg.bufs[idInfo.pid]; const n = b && b.arr.length ? b.arr[b.arr.length - 1] : null; if (n && n !== lastSeenObj) { lastSeenObj = n; browserStates++; } }, 10);
    await sleep(3500);
    clearInterval(ciw);
    const smp = await page.eval('(() => { const s = FM.net.sample("' + B.net.pid() + '"); return s && {x: s.x, it: s.it, g: s.g, age: s._age, d: FM.net.delay("' + B.net.pid() + '")}; })()');
    const bs = B.net.sample(idInfo.pid);
    if (smp && typeof smp.x === 'number' && smp.g === 1 && browserStates > 20 && bs && bs.it === 'dyn') pass('iki yönlü durum akışı: node, tarayıcıdan 3.5 sn\'de ' + browserStates + ' durum aldı; tarayıcıda ara değerleme gecikmesi ' + smp.d + ' ms, örnek yaşı ' + smp.age + ' ms');
    else fail('durum akışı: tarayıcı örneği ' + JSON.stringify(smp) + ', node aldığı ' + browserStates + ', node örneği ' + JSON.stringify(bs));

    // olaylar
    await page.eval('FM.net.sendEvent("item", {k: "saw", x: 10}); FM.net.emoji("🔥"); true');
    B.net.sendEvent('death', { by: idInfo.pid, cause: 'saw' });
    await waitFor(async () => Cc.ev.some(x => x.e === 'net:event' && x.d.type === 'item' && x.d.from === idInfo.pid && x.d.data.k === 'saw') && Cc.ev.some(x => x.e === 'net:emoji' && x.d.e === '🔥')
      && await page.eval('__ev.some(x => x.e === "net:event" && x.d.type === "death" && x.d.data.cause === "saw") && __ev.some(x => x.e === "net:emoji" && x.d.me)'), 8000, 'olaylar iki yönde');
    pass('olaylar ve emoji iki yönde ulaştı (Türkçe/emoji UTF-8 dahil)');

    // telefon arka plana atıldı: sayfayı dondur
    const fr = await page.send('Page.setWebLifecycleState', { state: 'frozen' });
    let frozenVia = 'Page.setWebLifecycleState';
    if (fr.error) { frozenVia = 'FM.net._dbg.freeze (CDP dondurma desteklenmedi: ' + fr.error.message + ')'; await page.eval('clearInterval(__st); FM.net._dbg.freeze(true)'); }
    const expect = [B, Cc].map(c => c.net.pid()).sort()[0];
    const tm = Date.now();
    await waitFor(() => B.net.host() === expect && Cc.net.host() === expect, 15000, 'node oyuncular yeni ev sahibinde uzlaştı');
    const migMs = Date.now() - tm;
    await sleep(1500);
    if (fr.error) await page.eval('FM.net._dbg.freeze(false)'); else await page.send('Page.setWebLifecycleState', { state: 'active' });
    const tb = Date.now();
    await waitFor(() => page.eval('FM.net.inRoom() && !FM.net.isHost() && FM.net.host() === "' + expect + '"'), 20000, 'tarayıcı uyanınca ev sahipliğini bıraktı');
    const nh = [B, Cc].find(c => c.net.isHost());
    await waitFor(() => { const p = nh.net.players().find(q => q.pid === idInfo.pid); return p && !p.off && p.alive; }, 15000, 'tarayıcı yeniden çevrimiçi');
    pass('sayfa donduruldu (' + frozenVia + ') → ' + migMs + ' ms sonra node ev sahibi oldu; sayfa uyanınca ' + (Date.now() - tb) + ' ms içinde üye olarak geri döndü');
    await page.eval('typeof __st !== "undefined" && clearInterval(__st); true'); clearInterval(niv);

    nh.net.toLobby();
    await waitFor(() => page.eval('__ev.some(x => x.e === "net:toLobby") && FM.net.lobby().st === "lobby"'), 8000, 'tarayıcıya toLobby');
    pass('yeni ev sahibinin toLobby mesajı tarayıcıya ulaştı');

    await page.eval('FM.net.leaveRoom(); true');
    for (const c of nodes) c.net.leaveRoom();
    await sleep(800);

    // ?oda=KOD linkiyle açılış
    await page.send('Page.navigate', { url: url.replace('?mobile=1', '?oda=' + code.toLowerCase() + '&mobile=1') });
    await waitFor(() => page.eval('!!(window.FM && FM.net)'), 15000, 'link sayfası');
    const lk = await page.eval('({c: FM.net.codeFromUrl(), cleared: (FM.net.clearUrlCode(), location.search.indexOf("oda=") < 0)})');
    if (lk.c === code && lk.cleared) pass('?oda=' + code.toLowerCase() + ' linkinden kod okundu, clearUrlCode adres çubuğunu temizledi'); else fail('link açılışı: ' + JSON.stringify(lk));
    await sleep(500);
  } catch (e) { fail('akış durdu: ' + (e && e.message)); }
  finally {
    for (const c of nodes) { try { c.net.leaveRoom(); } catch (e) { } }
    if (page) { try { const lg = await page.eval('FM.net.log().filter(l => l.indexOf("HATA") >= 0).slice(0, 5)'); for (const l of lg) errs.push('net.js yakalanan: ' + l); } catch (e) { } page.close(); }
    killChrome();
  }
  for (const e of errs) fail('tarayıcı: ' + e);
  if (!errs.length) pass('tarayıcı konsolunda hata/istisna yok');
  console.log('\nSONUÇ: ' + ok.length + ' geçti, ' + bad.length + ' kaldı');
  await sleep(700);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
  if (broker) await broker.close();
  process.exit(bad.length ? 1 : 0);
})();
