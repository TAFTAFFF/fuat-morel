// Kullanım: node dev/sim.js [koşu sayısı] — oyun mantığını (core+level+game+meta) tarayıcısız simüle eder, botların bitirme/ölüm istatistiğini yazar.
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { } // düşük öncelik: bilgisayarı yormasın (başlattığı Chrome da devralır)
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
function stubEl() { return { style: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false } }, addEventListener() { }, appendChild() { }, setAttribute() { }, querySelector() { return null }, querySelectorAll() { return [] }, getContext() { return new Proxy({}, { get: (t, p) => p in t ? t[p] : (() => ({ addColorStop() { } })), set: (t, p, v) => (t[p] = v, true) }) }, dataset: {} }; }
const store = {};
const sb = { console, Math, Date, JSON, setTimeout: () => 0, clearTimeout() { }, performance: { now: () => Date.now() }, requestAnimationFrame() { },
  localStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } },
  location: { search: '' }, URLSearchParams, navigator: { maxTouchPoints: 0 }, matchMedia: () => ({ matches: false, addEventListener() { } }), innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, addEventListener() { },
  document: { getElementById: () => stubEl(), createElement: () => stubEl(), querySelector: () => stubEl(), querySelectorAll: () => [], addEventListener() { }, body: stubEl(), fonts: null } };
sb.window = sb; vm.createContext(sb);
for (const f of ['core', 'gfx', 'level', 'game', 'meta']) { const p = path.join(root, 'js', f + '.js'); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f + '.js' }); }
const FM = sb.FM; FM.view.VW = 1000;
const N = +(process.argv[2] || 10); let allFin = 0, errors = 0; const deaths = {}; const times = []; let nDeath = 0, nUse = 0, sumT = 0;
FM.on('item:use', () => nUse++);
FM.on('death', d => { const k = d.cause; deaths[k] = (deaths[k] || 0) + 1; nDeath++; });
for (let run = 0; run < N; run++) {
  try {
    FM.game.startMatch({ char: FM.ORDER[run % 7], rounds: 1, auto: true });
    FM.S.countT = .01;
    let t = 0; while (t < 200 && FM.S.mode !== 'end' && FM.S.mode !== 'podium') { FM.game.step(FM.C.STEP); t += FM.C.STEP; for (const p of FM.S.parts) p.life -= FM.C.STEP; FM.S.parts = FM.S.parts.filter(p => p.life > 0); }
    const fin = FM.S.racers.filter(r => r.finished).length; if (fin === 4) allFin++; sumT += FM.S.raceT;
    times.push(FM.S.racers.filter(r => r.finished).map(r => r.ftime.toFixed(1)).join('/'));
    console.log(`koşu ${run + 1} ${FM.S.L.theme.n} bitiren ${fin}/4 süreler ${times[times.length - 1]} ölümler ${FM.S.racers.map(r => r.id + ':' + r.deaths).join(' ')} altın ${FM.S.racers.map(r => r.coins).join(',')}`);
  } catch (e) { errors++; console.log('HATA', e.stack); }
}
console.log(`\nToplam: ${allFin}/${N} koşuda 4 kişi bitirdi, hata ${errors}. Ortalama süre ${(sumT / Math.max(1, N)).toFixed(1)} sn, yarış başına ölüm ${(nDeath / Math.max(1, N)).toFixed(1)}, yarışçı başına eşya kullanımı ${(nUse / Math.max(1, N) / 4).toFixed(1)}. Ölüm nedenleri:`, deaths);
