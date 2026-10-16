// Kullanım: node dev/pwa-check.js [çıktı klasörü]
// Oyunu yerel HTTP sunucusundan (service worker için http gerekir) headless Chrome'da açar ve CDP ile denetler:
// konsol hataları, manifest hataları (Page.getAppManifest), kurulabilirlik (Page.getInstallabilityErrors), service worker
// etkin mi + önbellek, kayıt kodu dışa/içe aktarma (tarayıcıda CompressionStream), sunucu kapatılınca ÇEVRİMDIŞI açılış.
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(process.argv[2] || os.tmpdir());
const PORT = 8700 + (process.pid % 200), DBG = 9300 + (process.pid % 200);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('yok'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  fs.createReadStream(f).pipe(res);
});
const chromePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const profile = path.join(os.tmpdir(), 'fm-pwa-' + process.pid);
const wait = ms => new Promise(r => setTimeout(r, ms));
let chrome = null, fails = 0;
function ok(c, m) { console.log((c ? 'OK   ' : 'HATA ') + m); if (!c) fails++; }
(async () => {
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run', '--hide-scrollbars', '--user-data-dir=' + profile,
    '--remote-debugging-port=' + DBG, '--window-size=844,390', 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 50 && !list; i++) { await wait(200); try { list = await (await fetch('http://127.0.0.1:' + DBG + '/json/list')).json(); } catch (e) { } }
  const pg = list.find(t => t.type === 'page');
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {}; const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push('istisna: ' + (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 300));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('log: ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || ''));
  };
  const cmd = (method, params) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : r; };
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Page.enable');
  const base = 'http://127.0.0.1:' + PORT + '/';
  await cmd('Page.navigate', { url: base + 'index.html?oda=ABCDE' });
  await wait(7000);
  const man = await cmd('Page.getAppManifest');
  const mr = man.result || {};
  ok(mr.url && mr.url.indexOf('manifest.webmanifest') > 0, 'manifest bulundu: ' + mr.url);
  ok(Array.isArray(mr.errors) && mr.errors.length === 0, 'manifest hatası yok ' + JSON.stringify(mr.errors));
  const inst = await cmd('Page.getInstallabilityErrors');
  const ie = (inst.result && inst.result.installabilityErrors) || [];
  ok(ie.length === 0, 'kurulabilir (installability) ' + JSON.stringify(ie));
  const sw = await ev(`navigator.serviceWorker.getRegistration().then(r => ({ reg: !!r, active: !!(r && r.active), ctl: !!navigator.serviceWorker.controller, err: FM.pwa.err }))`);
  ok(sw && sw.reg && sw.active, 'service worker etkin ' + JSON.stringify(sw));
  const ck = await ev(`caches.keys().then(async ks => { const out = {}; for (const k of ks) out[k] = (await (await caches.open(k)).keys()).length; return out; })`);
  console.log('     önbellekler: ' + JSON.stringify(ck));
  ok(Object.keys(ck).some(k => k.indexOf('fuatmorel-fm-') === 0 && ck[k] >= 20), 'önbellekte oyun dosyaları');
  const info = await ev(`({ inApp: FM.inAppBrowser(), sa: FM.isStandalone(), coins: FM.save.coins, persisted: FM.storage.persisted, mode: FM.S.mode, title: document.title })`);
  console.log('     ' + JSON.stringify(info));
  const xr = await ev(`(async () => { const c = await FM.meta.exportCode(); const r = await FM.meta.importCode(c); return { len: c && c.length, pre: c && c.slice(0, 4), ok: r.ok, lvl: r.ok && r.preview.level }; })()`);
  ok(xr && xr.ok && xr.pre === 'FM1.', 'tarayıcıda kayıt kodu (gzip) ' + JSON.stringify(xr));
  await cmd('Page.captureScreenshot', { format: 'png' }).then(r => { if (r.result) { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'pwa-online.png'), Buffer.from(r.result.data, 'base64')); } });
  const onlineErrs = errs.slice();
  // ÇEVRİMDIŞI: sunucuyu kapat, yeniden yükle
  await new Promise(r => { srv.close(r); setTimeout(r, 1500); });
  if (srv.closeAllConnections) srv.closeAllConnections();
  errs.length = 0;
  await cmd('Page.navigate', { url: base + 'index.html?oda=XYZ23' });
  await wait(9000);
  const off = await ev(`({ fm: typeof FM === 'object' && !!FM.meta && !!FM.game, mode: FM && FM.S && FM.S.mode, ui: !!document.querySelector('#ui') && document.querySelector('#ui').children.length })`);
  ok(off && off.fm && off.ui > 0, 'çevrimdışı açılış (sunucu kapalı) ' + JSON.stringify(off));
  await cmd('Page.captureScreenshot', { format: 'png' }).then(r => { if (r.result) fs.writeFileSync(path.join(outDir, 'pwa-offline.png'), Buffer.from(r.result.data, 'base64')); });
  const offErrs = errs.filter(e => !/net::ERR|Failed to load resource|fonts\.g/.test(e));
  ok(onlineErrs.length === 0, 'çevrimiçi konsol hatası yok' + (onlineErrs.length ? ': ' + onlineErrs.join(' | ') : ''));
  ok(offErrs.length === 0, 'çevrimdışı konsol hatası yok (ağ hataları hariç)' + (offErrs.length ? ': ' + offErrs.join(' | ') : ''));
  ws.close();
  console.log(fails ? 'BAŞARISIZ (' + fails + ')' : 'TAMAM');
  finish(fails ? 1 : 0);
})().catch(e => { console.log('İSTİSNA ' + (e && e.stack || e)); finish(1); });
function finish(code) {
  try { srv.close(); } catch (e) { }
  try { chrome && chrome.kill(); } catch (e) { }
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { } process.exit(code); }, 1200);
}
