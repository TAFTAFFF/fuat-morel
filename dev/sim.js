// Kullanım: node dev/sim.js [koşu sayısı] [mod] [tema] [yarışçı sayısı]
//   mod: classic | elim | coins | pure | chaos (varsayılan classic)
//   tema: 0..7 ya da id (forest, candy, snow, castle, desert, space, city, tropic), 'all' = sırayla hepsi; verilmezse rastgele (eski 4 tema)
//   yarışçı sayısı: 2..10 (varsayılan 4)
// Örnek: node dev/sim.js 8 elim 5 10
// Oyun mantığını (core+level+game+meta) tarayıcısız simüle eder; bitirme/ölüm/eleme/altın istatistiği ve tutarlılık denetimi yazar.
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
for (const f of ['core', 'gfx', 'net', 'level', 'game', 'meta', 'netgame']) { const p = path.join(root, 'js', f + '.js'); if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), sb, { filename: f + '.js' }); }
const FM = sb.FM; FM.view.VW = 1000;
const N = +(process.argv[2] || 10);
const MODE = process.argv[3] && FM.modeById(process.argv[3]) ? process.argv[3] : 'classic';
const TH = process.argv[4];
const NR = Math.max(2, Math.min(FM.MAXR, +(process.argv[5] || 4)));
const themeFor = run => TH == null || TH === 'random' ? 'random' : TH === 'all' ? run % FM.THEMES.length : (isFinite(+TH) ? +TH : TH);
let allFin = 0, errors = 0, warns = 0; const deaths = {}; const times = []; let nDeath = 0, nUse = 0, sumT = 0;
const ev = { portal: 0, vent: 0, tramp: 0, gate: 0, eliminated: 0, meteor: 0, drop: 0, pick: 0, bonus: 0 };
FM.on('item:use', () => nUse++);
FM.on('death', d => { const k = d.cause; deaths[k] = (deaths[k] || 0) + 1; nDeath++; });
FM.on('portal', () => ev.portal++); FM.on('vent', () => ev.vent++); FM.on('mush', d => { if (d.kind === 'tramp') ev.tramp++; });
FM.on('gate', () => ev.gate++); FM.on('eliminated', () => ev.eliminated++); FM.on('meteor', () => ev.meteor++);
FM.on('coins:drop', () => ev.drop++); FM.on('coins:pick', () => ev.pick++); FM.on('coins:bonus', () => ev.bonus++);
const bad = v => typeof v !== 'number' || !isFinite(v);
for (let run = 0; run < N; run++) {
  try {
    FM.game.startMatch({ char: FM.ORDER[run % 7], rounds: 1, auto: true, mode: MODE, theme: themeFor(run), n: NR });
    FM.S.countT = .01;
    const S = FM.S, R = S.racers;
    const prog = R.map(r => ({ x: r.x, t: 0 }));
    let t = 0, stuck = '';
    while (t < 200 && S.mode !== 'end' && S.mode !== 'podium') {
      FM.game.step(FM.C.STEP); t += FM.C.STEP;
      for (const p of S.parts) p.life -= FM.C.STEP; S.parts = S.parts.filter(p => p.life > 0);
      // tutarlılık: sayısal bozulma / ilerlemeyen yarışçı
      for (let i = 0; i < R.length; i++) {
        const r = R[i];
        if (bad(r.x) || bad(r.y) || bad(r.vx) || bad(r.vy)) throw new Error('NaN konum: ' + r.name);
        if (r.finished || r.out || r.dead > 0) { prog[i].x = r.x; prog[i].t = t; continue; }
        if (r.x > prog[i].x + 200) { prog[i].x = r.x; prog[i].t = t; }
        else if (t - prog[i].t > 25 && !stuck) { stuck = `${r.name} @${Math.round(r.x)},${Math.round(r.y)} 25 sn ilerlemedi`; warns++; }
      }
    }
    const fin = R.filter(r => r.finished).length, out = R.filter(r => r.out).length;
    const want = MODE === 'elim' ? fin + out === R.length || R.filter(r => !r.out).length === 1 : MODE === 'coins' ? true : fin === R.length;
    if (want) allFin++;
    sumT += S.raceT;
    times.push(R.filter(r => r.finished).map(r => r.ftime.toFixed(1)).join('/'));
    const L = S.L;
    const extra = MODE === 'elim' ? ` elenen ${out} kapı ${L.gates.map(g => (g.off ? '-' : g.done ? 'K' : 'A')).join('')} kazanan ${(FM.game.ranking()[0] || {}).name}`
      : MODE === 'coins' ? ` süre ${S.raceT.toFixed(1)} altın ${FM.game.ranking().map(r => r.name + ':' + r.coins).join(' ')}` : '';
    console.log(`koşu ${run + 1} [${MODE}] ${L.theme.n} (${L.theme.id}) uzunluk ${Math.round(L.end)} bitiren ${fin}/${R.length} süreler ${times[times.length - 1]} ölümler ${R.map(r => r.name + ':' + r.deaths).join(' ')}${extra}${stuck ? '  UYARI: ' + stuck : ''}${want ? '' : '  !! beklenen bitiş olmadı'}`);
  } catch (e) { errors++; console.log('HATA', e.stack); }
}
console.log(`\nToplam: ${allFin}/${N} koşu beklendiği gibi bitti (mod ${MODE}, ${NR} yarışçı), hata ${errors}, uyarı ${warns}. Ortalama süre ${(sumT / Math.max(1, N)).toFixed(1)} sn, yarış başına ölüm ${(nDeath / Math.max(1, N)).toFixed(1)}, yarışçı başına eşya kullanımı ${(nUse / Math.max(1, N) / NR).toFixed(1)}.`);
console.log('Olaylar:', JSON.stringify(ev), ' Ölüm nedenleri:', JSON.stringify(deaths));
