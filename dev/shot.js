// Kullanım: node dev/shot.js "scene=race&t=8&theme=0&char=Kral" cikti.png [genişlik] [yükseklik]
// Headless Chrome ile oyunun geliştirici modunda tek kare ekran görüntüsü alır ve tarayıcı konsol hatalarını yazdırır.
// Telefon düzeni (dokunmatik düğmeler dahil): node dev/shot.js "scene=race&t=8&mobile=1&touch=1&ui=touch" cikti.png 844 390
// Not: duraklatılmış sahne main.js tarafından yarım saniyede bir çizilir; sanal zaman bütçesi boyunca CPU boşta kalır.
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { } // düşük öncelik: bilgisayarı yormasın (başlattığı Chrome da devralır)
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const q = process.argv[2] || 'scene=race&t=8';
const out = path.resolve(process.argv[3] || 'shot.png');
const W = +(process.argv[4] || 1280), H = +(process.argv[5] || 720);
const candidates = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
];
const chrome = candidates.find(p => fs.existsSync(p));
if (!chrome) { console.error('Chrome/Edge bulunamadı'); process.exit(1); }
const root = path.resolve(__dirname, '..').split(path.sep).join('/');
const url = 'file:///' + root + '/index.html?dev=1&' + q;
const profile = path.join(require('os').tmpdir(), 'fm-shot-' + process.pid);
if (fs.existsSync(out)) fs.unlinkSync(out);
const res = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--no-first-run',
  '--user-data-dir=' + profile, '--window-size=' + W + ',' + H, '--virtual-time-budget=4000',
  '--enable-logging=stderr', '--v=0',
  '--screenshot=' + out, url], { encoding: 'utf8', timeout: 90000 });
if (res.error) console.log('chrome hata: ' + res.error.message); if (res.status) console.log('chrome çıkış kodu: ' + res.status);
const NL = String.fromCharCode(10);
const lines = String(res.stderr || '').split(NL);
const errLines = lines.filter(l => l.indexOf('CONSOLE') >= 0 || l.indexOf('Uncaught') >= 0);
for (const l of errLines.slice(0, 40)) console.log('[tarayici] ' + l.slice(l.indexOf('CONSOLE') >= 0 ? l.indexOf('CONSOLE') : 0, 500));
console.log(fs.existsSync(out) ? 'OK ' + out : 'BASARISIZ');
try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { }
