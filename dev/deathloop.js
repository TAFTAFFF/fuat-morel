// Ölüm döngüsü avcısı: çok ölümlü koşularda ölüm noktası çevresindeki harita öğelerini döker.
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { } // düşük öncelik: bilgisayarı yormasın (başlattığı Chrome da devralır)
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
const head = src.slice(0, src.indexOf('const N ='));
eval(head.replace("const FM = sb.FM;", "var FM = sb.FM;"));
const N = +(process.argv[2] || 20);
for (let run = 0; run < N; run++) {
  const seed = (+(process.argv[3] || 1000)) + run;
  const deaths = [];
  const h = d => deaths.push({ x: Math.round(d.r.x), y: Math.round(d.r.y), cause: d.cause, id: d.r.id, safe: Math.round(d.r.safe.x) });
  FM.on('death', h);
  FM.game.startMatch({ char: FM.ORDER[run % 7], rounds: 1, auto: true, seed, theme: (process.argv[4] != null ? +process.argv[4] : run % 4), themeIdx: (process.argv[4] != null ? +process.argv[4] : run % 4) });
  FM.S.countT = .01;
  let t = 0; while (t < 200 && FM.S.mode !== 'end' && FM.S.mode !== 'podium') { FM.game.step(FM.C.STEP); t += FM.C.STEP; FM.S.parts.length = 0; }
  FM.off('death', h);
  const fin = FM.S.racers.filter(r => r.finished).length;
  if (deaths.length > 25) {
    const b = {}; for (const d of deaths) { const k = Math.round(d.safe / 50) * 50; b[k] = (b[k] || 0) + 1; }
    const top = Object.entries(b).sort((a, c) => c[1] - a[1])[0];
    const sx = +top[0]; const L = FM.S.L;
    console.log(`seed ${seed} tema ${run % 4} bitiren ${fin} ölüm ${deaths.length} — en sık güvenli nokta ~${sx} (${top[1]})`);
    console.log('  ölümler örnek:', JSON.stringify(deaths.slice(0, 6)));
    const near = o => o.x > sx - 300 && o.x < sx + 700;
    console.log('  zeminler:', L.solids.filter(s => s.x + s.w > sx - 300 && s.x < sx + 700).map(s => `[${Math.round(s.x)}-${Math.round(s.x + s.w)} y${Math.round(s.y)}${s.float ? ' F' : ''}]`).join(' '));
    console.log('  kutular:', L.boxes.filter(near).map(o => `${Math.round(o.x)},${Math.round(o.y)}`).join(' '), ' mantar:', L.mush.filter(near).map(o => Math.round(o.x)).join(','), ' pad:', L.pads.filter(near).map(o => Math.round(o.x)).join(','), ' diken:', L.spikes.filter(near).map(o => Math.round(o.x)).join(','));
  }
}
console.log('bitti');
