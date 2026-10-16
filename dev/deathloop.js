// Ölüm döngüsü avcısı: çok ölümlü koşularda ölüm noktası çevresindeki harita öğelerini döker.
// Kullanım: node dev/deathloop.js [koşu] [başlangıç seed] [tema 0..7 | id] [mod]   (tema verilmezse eski 4 tema sırayla)
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { } // düşük öncelik: bilgisayarı yormasın (başlattığı Chrome da devralır)
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
const head = src.slice(0, src.indexOf('const N ='));
eval(head.replace("const FM = sb.FM;", "var FM = sb.FM;"));
const N = +(process.argv[2] || 20);
const TA = process.argv[4], MODE = process.argv[5] || 'classic';
let total = 0, worst = 0, fails = 0;
for (let run = 0; run < N; run++) {
  const seed = (+(process.argv[3] || 1000)) + run;
  const th = TA != null ? (isFinite(+TA) ? +TA : TA) : run % 4;
  const deaths = [];
  const h = d => deaths.push({ x: Math.round(d.r.x), y: Math.round(d.r.y), cause: d.cause, id: d.r.id, safe: Math.round(d.r.safe.x) });
  FM.on('death', h);
  FM.game.startMatch({ char: FM.ORDER[run % 7], rounds: 1, auto: true, seed, theme: th, themeIdx: th, mode: MODE, n: 4 });
  FM.S.countT = .01;
  let t = 0; while (t < 200 && FM.S.mode !== 'end' && FM.S.mode !== 'podium') { FM.game.step(FM.C.STEP); t += FM.C.STEP; FM.S.parts.length = 0; }
  FM.off('death', h);
  const fin = FM.S.racers.filter(r => r.finished).length;
  total += deaths.length; worst = Math.max(worst, deaths.length);
  if (fin < FM.S.racers.length && MODE !== 'elim' && MODE !== 'coins') {
    fails++;
    const lag = FM.S.racers.filter(r => !r.finished).map(r => `${r.name}@${Math.round(r.x)},${Math.round(r.y)} ölüm ${r.deaths} son: ${deaths.filter(d => d.id === r.id).slice(-3).map(d => d.cause + '@' + d.x).join(' ')}`);
    console.log(`seed ${seed} tema ${FM.S.L.theme.id}: bitiren ${fin}/${FM.S.racers.length} (süre ${FM.S.raceT.toFixed(1)}, bitiş x ${Math.round(FM.S.L.end)}) — ${lag.join(' | ')}`);
  }
  if (deaths.length > 25) {
    const b = {}; for (const d of deaths) { const k = Math.round(d.safe / 50) * 50; b[k] = (b[k] || 0) + 1; }
    const top = Object.entries(b).sort((a, c) => c[1] - a[1])[0];
    const sx = +top[0]; const L = FM.S.L;
    console.log(`seed ${seed} tema ${L.theme.id} bitiren ${fin} ölüm ${deaths.length} — en sık güvenli nokta ~${sx} (${top[1]})`);
    console.log('  ölümler örnek:', JSON.stringify(deaths.slice(0, 6)));
    const near = o => o.x > sx - 300 && o.x < sx + 700;
    console.log('  zeminler:', L.solids.filter(s => s.x + s.w > sx - 300 && s.x < sx + 700).map(s => `[${Math.round(s.x)}-${Math.round(s.x + s.w)} y${Math.round(s.y)}${s.float ? ' F' : ''}]`).join(' '));
    console.log('  kutular:', L.boxes.filter(near).map(o => `${Math.round(o.x)},${Math.round(o.y)}`).join(' '), ' mantar:', L.mush.filter(near).map(o => Math.round(o.x)).join(','), ' pad:', L.pads.filter(near).map(o => Math.round(o.x)).join(','), ' diken:', L.spikes.filter(near).map(o => Math.round(o.x)).join(','));
    console.log('  kaya:', L.boulders.filter(o => o.x1 > sx - 300 && o.x0 < sx + 700).map(o => `${Math.round(o.x0)}-${Math.round(o.x1)}`).join(' '), ' baca/gayzer:', L.vents.filter(near).map(o => o.kind + '@' + Math.round(o.x)).join(','), ' trambolin:', L.tramp.filter(near).map(o => Math.round(o.x)).join(','), ' kapı:', L.portals.filter(o => o.ax > sx - 300 && o.ax < sx + 700).map(o => Math.round(o.ax) + '→' + Math.round(o.bx)).join(','), ' düşükG:', L.lowg.filter(near).map(o => Math.round(o.x) + '+' + Math.round(o.w)).join(','));
  }
}
console.log(`bitti — ölüm ort ${(total / Math.max(1, N)).toFixed(1)}, en çok ${worst}, bitiremeyen koşu ${fails}`);
