// Antrenman yarışı denetimi (tarayıcısız): FM.S.tutorial = true ile sabit kolay pist (tema 0, seed 7), ipucuna (FM.S.hint) göre
// doğru hareketi doğru anda yapan oto-oyuncu. Her karakterle bir koşu. Denetler:
//   • oyuncu 1. bitirir (süre 35-45 sn civarı),
//   • hiçbir bot saldırısı (eşya/güç) oyuncuya değmez,
//   • FM.S.hint.act olarak jump / slide / dbl / climb en az bir kez görülür,
//   • oyuncunun gücü bir kez dolar (charge:full tam 1 kez), ilk 3 sn'de ölüm yok,
//   • "hareketsiz oyuncu": hiçbir tuşa basmayan oyuncuda yarış bitmez, hiçbir bot bitişe varmaz (yeni oyuncu takılırsa beklenir).
// Kullanım: node dev/tutorial.js [karakter (varsayılan: hepsi)]      Çıkış kodu: sorun varsa 1.
try { require('os').setPriority(0, require('os').constants.priority.PRIORITY_LOW); } catch (e) { }
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'sim.js'), 'utf8');
const head = src.slice(0, src.indexOf('const N ='));
eval(head.replace("const FM = sb.FM;", "var FM = sb.FM;"));
FM.view.VW = 1000;
const S = FM.S, G = FM.game, I = FM.input, STEP = FM.C.STEP;
const CHARS = process.argv[2] ? [process.argv[2]] : Object.keys(FM.CH);
const fails = [];
const clearIn = () => { I.jp = I.dp = I.use = I.ab = false; I.jh = I.dh = false; I.aim = null; };
function start(ch) {
  S.tutorial = true;
  G.startMatch({ char: ch, rounds: 1, mode: 'classic', theme: 0, n: 4, seed: 7 });
  S.countT = .01;
  const P = S.player; P.bot = false; P.ctrl = 'local';
  return P;
}
// ipucuna göre oyuncu gibi davran
function autoplay(P, st) {
  clearIn();
  const h = G.updateHint();
  if (h) { st.acts[h.act] = (st.acts[h.act] || 0) + 1; st.kinds[h.kind] = 1; }
  I.jh = P.blocked || P.climb || (P.vy < 0 && st.hold);
  if (P.onGround) { st.hold = false; st.dbl = false; }
  if (h && (P.onGround || P.coy > 0)) {
    if (h.act === 'jump' && h.eta <= (h.kind === 'wall' ? .2 : .14)) { I.jp = true; st.hold = true; }
    else if (h.act === 'dbl' && h.dist <= 6) { I.jp = true; st.dbl = true; st.hold = true; }
    else if (h.act === 'climb' && h.eta <= .25) { I.jp = true; st.hold = true; }
    else if (h.act === 'slide' && h.eta <= .1 && !P.slide) I.dp = true;
  }
  if (h && h.act === 'slide' && (P.slide || h.dist <= 0)) I.dh = true;
  // çift zıplama: inişe geçince (karşı kenara yetişmek için)
  if (st.dbl && !P.onGround && P.vy > 40 && P.jumps < 2) { I.jp = true; st.dbl = false; }
  if (P.item) { st.itemT = (st.itemT || 0) + STEP; if (st.itemT > .6) { I.use = true; st.itemT = 0; } }
  if (P.charge >= 100) I.ab = true;
}
function run(ch, lazy) {
  const P = start(ch);
  const st = { acts: {}, kinds: {}, full: 0, early: 0, botHits: [], hold: false, dbl: false, items: [], ab: 0 };
  const onUse = d => { if (d.r === P) st.items.push(d.item); }, onAb = d => { if (d.r === P) st.ab++; };
  FM.on('item:use', onUse); FM.on('ability', onAb);
  const onFull = d => { if (d.r === P) { st.full++; st.fullT = S.raceT; } };
  const onHit = d => { if (d.victim === P && d.src && d.src !== P) st.botHits.push(`${d.src.id}:${d.cause}`); };
  const onDeath = d => { if (d.r === P && S.raceT < 3) st.early++; if (d.r === P && d.killer && d.killer !== P) st.botHits.push(`${d.killer.id}:${d.cause} (ölüm)`); };
  FM.on('charge:full', onFull); FM.on('hit', onHit); FM.on('death', onDeath);
  let t = 0, botFin = 0;
  const LIM = lazy ? 75 : 120;
  try {
    while (t < LIM && S.mode !== 'end' && S.mode !== 'podium') {
      if (lazy) clearIn(); else if (S.mode === 'race') autoplay(P, st);
      G.step(STEP); t += STEP; S.parts.length = 0;
      botFin = S.racers.filter(r => r !== P && r.finished).length;
    }
  } finally { FM.off('item:use', onUse); FM.off('ability', onAb); FM.off('charge:full', onFull); FM.off('hit', onHit); FM.off('death', onDeath); clearIn(); S.tutorial = false; }
  return { P, st, t, botFin, mode: S.mode, end: S.L.end };
}
for (const ch of CHARS) {
  const { P, st, botFin, end } = run(ch, false);
  const nm = `${ch}`;
  const bad = [];
  if (!P.finished) bad.push(`bitiremedi (x ${Math.round(P.x)} / ${Math.round(end)})`);
  else if (P.place !== 1) bad.push(`${P.place}. oldu (bot bitiren ${botFin})`);
  if (st.botHits.length) bad.push('bot saldırısı oyuncuya değdi: ' + st.botHits.join(', '));
  for (const a of ['jump', 'slide', 'dbl', 'climb']) if (!st.acts[a]) bad.push(`ipucu '${a}' görülmedi`);
  if (st.full !== 1) bad.push(`charge:full ${st.full} kez (1 olmalı)`);
  if (!st.items.includes('saw')) bad.push('kutudan testere alınıp atılmadı');
  if (st.early) bad.push(`ilk 3 sn'de ${st.early} ölüm`);
  console.log(`${nm.padEnd(8)} ${P.finished ? P.place + '. ' + P.ftime.toFixed(1) + ' sn' : 'bitmedi'} | ölüm ${P.deaths} | ipucu ${Object.keys(st.acts).sort().join(',')} (${Object.keys(st.kinds).sort().join(',')}) | güç dolumu ${st.full}${st.fullT ? ' (' + st.fullT.toFixed(1) + ' sn\'de)' : ''} | eşya ${st.items.join(',') || '-'} | güç ${st.ab}${bad.length ? '  !! ' + bad.join('; ') : ''}`);
  if (bad.length) fails.push(nm + ': ' + bad.join('; '));
}
// hareketsiz oyuncu: yarış bitmemeli, bot bitişe varmamalı
{
  const { P, t, botFin, mode } = run(CHARS[0], true);
  const ok = mode === 'race' && botFin === 0 && !P.finished;
  console.log(`hareketsiz oyuncu (${Math.round(t)} sn): yarış ${mode}, bitiren bot ${botFin}, oyuncu x ${Math.round(P.x)}${ok ? '' : '  !! yarış bitmemeli / bot bitirmemeli'}`);
  if (!ok) fails.push('hareketsiz oyuncu: yarış bitti ya da bot bitirdi');
}
console.log(fails.length ? `\n!! ${fails.length} sorun` : '\nTamam: antrenman yarışı kolay, adil ve öğretici');
process.exitCode = fails.length ? 1 : 0;
