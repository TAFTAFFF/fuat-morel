// Kullanım: node dev/sim.js [koşu sayısı] [mod] [tema] [yarışçı sayısı] [ilk seed] [--ek (yeni karakterler de)]
//   mod: classic | elim | coins | pure | chaos (varsayılan classic)
//   tema: 0..7 ya da id (forest, candy, snow, castle, desert, space, city, tropic), 'all' = sırayla hepsi; verilmezse rastgele (eski 4 tema)
//   yarışçı sayısı: 2..10 (varsayılan 4)
//   ilk seed: verilirse harita seed'leri ilk seed + koşu (karşılaştırmalı ölçüm; botlar yine rastgele karar verir)
// Örnek: node dev/sim.js 8 elim 5 10
// Ölçümler: bitiş/ölüm/eleme, ölüm nedenleri, yönlü eşya/güç kullanımı, ZAMAN KAYBI (donma/ağ/sersemleme/yavaşlama/ölü bekleme),
//   EŞYA SONUÇLARI (kullanım → isabet/öldürme/sıvıda kaybolma), HAVADA KALAN nesne (tuzak/ağ yere oturmadan duran = 0 olmalı),
//   TAKILMA (canlıyken 2 sn'de 60 px'ten az ilerleme), his (kusursuz/kıl payı/rüzgâr arkası).
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
const N = +(process.argv.filter(a => a !== '--ek')[2] || 10);
// --ek: yeni karakterler (FM.CH tag 'tipleme') de yarışır (FM.ROSTER_EXTRA) ve oyuncu karakteri onlar arasında da döner
const EK = process.argv.includes('--ek'), ARGV = process.argv.filter(a => a !== '--ek');
if (EK) FM.ROSTER_EXTRA = true;
const ROSTER = EK ? FM.game.rosterPool() : FM.ORDER;
const MODE = ARGV[3] && FM.modeById(ARGV[3]) ? ARGV[3] : 'classic';
const TH = ARGV[4];
const NR = Math.max(2, Math.min(FM.MAXR, +(ARGV[5] || 4)));
const SEED0 = ARGV[6] != null && isFinite(+ARGV[6]) ? +ARGV[6] : null;
const themeFor = run => TH == null || TH === 'random' ? 'random' : TH === 'all' ? run % FM.THEMES.length : (isFinite(+TH) ? +TH : TH);
let allFin = 0, errors = 0, warns = 0; const deaths = {}; const times = []; let nDeath = 0, nUse = 0, sumT = 0;
const ev = { portal: 0, vent: 0, tramp: 0, gate: 0, eliminated: 0, meteor: 0, drop: 0, pick: 0, bonus: 0 };
FM.on('item:use', () => nUse++);
// yönlü atış istatistiği (docs/TUR5.md §2): eşya/güç kullanımı ve öldürmeler yöne göre (varsayılan | fwd | back | up | down)
const dirOf = p => !p || !(p.ax || p.ay) ? 'varsayılan' : p.ax < -.3 ? 'back' : p.ay < -.35 ? 'up' : p.ay > .35 ? 'down' : 'fwd';
const aimUse = {}, aimKill = {}, abUse = {}, feel = { perfect: 0, nearmiss: 0, draftMax: 0, chargeFull: 0 };
FM.on('item:use', d => { const k = d.item + ':' + dirOf(d.p); aimUse[k] = (aimUse[k] || 0) + 1; });
FM.on('ability', d => { const k = d.id + ':' + dirOf(d.p); abUse[k] = (abUse[k] || 0) + 1; });
FM.on('death', d => { if (d.killer && d.ent && d.ent.o === d.killer) { const k = d.cause + ':' + (d.ent.aim || 'varsayılan'); aimKill[k] = (aimKill[k] || 0) + 1; } });
FM.on('perfect', () => feel.perfect++); FM.on('nearmiss', () => feel.nearmiss++); FM.on('charge:full', () => feel.chargeFull++);
FM.on('death', d => { const k = d.cause; deaths[k] = (deaths[k] || 0) + 1; nDeath++; });
FM.on('portal', () => ev.portal++); FM.on('vent', () => ev.vent++); FM.on('mush', d => { if (d.kind === 'tramp') ev.tramp++; });
FM.on('gate', () => ev.gate++); FM.on('eliminated', () => ev.eliminated++); FM.on('meteor', () => ev.meteor++);
FM.on('coins:drop', () => ev.drop++); FM.on('coins:pick', () => ev.pick++); FM.on('coins:bonus', () => ev.bonus++);
const bad = v => typeof v !== 'number' || !isFinite(v);
// zaman kaybı ve eşya sonuçları
const lost = { donma: 0, ag: 0, sersem: 0, yavas: 0, cekilme: 0, olu: 0, hazirlik: 0, takili: 0 };
const itemOut = {};   // eşya → {kul, isabet, oldur, kayip}
const io = k => itemOut[k] || (itemOut[k] = { kul: 0, isabet: 0, oldur: 0, kayip: 0 });
FM.on('item:use', d => { io(d.item).kul++; });
FM.on('hit', d => { if (d.cause && FM.ITEMS[d.cause]) io(d.cause).isabet++; });
// öldürme: eşyanın KENDİSİ (varlığı ya da doğrudan etkisi) öldürdüyse; engelde ölüm ayrı sayılır (testere makinesi ≠ atılan testere)
const envDeath = {};
FM.on('death', d => {
  const thrown = d.ent && FM.ITEMS[d.ent.type] ? d.ent.type : d.ent && (d.ent.type === 'flash' || d.ent.type === 'bolt') ? 'bolt' : null;
  if (thrown) io(thrown).oldur++;
  else if (!d.ent && (d.cause === 'saw' || !(d.cause && FM.ITEMS[d.cause]))) { const k = d.cause === 'saw' ? 'testere-makinesi' : d.cause; envDeath[k] = (envDeath[k] || 0) + 1; }
});
FM.on('fizzle', d => { io(d.type).kayip++; });
// özel güç sonuçları: kullanım → etkilenen (sersem/savrulma/yavaşlama/donma isabeti), öldürme; Martı kapma ayrı
const abOut = {}, ao = k => abOut[k] || (abOut[k] = { kul: 0, isabet: 0, oldur: 0 });
const AB_CAUSE = { Teyze: 'Teyze', Almanci: 'Almanci', Marti: 'Marti', Kral: 'Kral', LUL: 'LUL', Caner: 'Caner', baso: 'baso' };
FM.on('ability', d => { ao(d.id).kul++; });
FM.on('hit', d => { if (d.cause && AB_CAUSE[d.cause]) ao(d.cause).isabet++; });
FM.on('steal', d => { const o = ao('Marti'); o.kapma = (o.kapma || 0) + (d.item ? 1 : 0); });
let floating = 0, floatSeen = new WeakSet(), stuckEv = 0;
for (let run = 0; run < N; run++) {
  try {
    FM.game.startMatch({ char: ROSTER[run % ROSTER.length], rounds: 1, auto: true, mode: MODE, theme: themeFor(run), n: NR, seed: SEED0 != null ? SEED0 + run : undefined });
    FM.S.countT = .01;
    const S = FM.S, R = S.racers;
    const prog = R.map(r => ({ x: r.x, t: 0 }));
    const win = R.map(r => ({ x: r.x, t: 0 }));   // takılma penceresi (2 sn)
    const flyT = new Map();
    let t = 0, stuck = '';
    while (t < 200 && S.mode !== 'end' && S.mode !== 'podium') {
      FM.game.step(FM.C.STEP); t += FM.C.STEP;
      for (const p of S.parts) p.life -= FM.C.STEP; S.parts = S.parts.filter(p => p.life > 0);
      for (const r of R) if (r.draft > feel.draftMax) feel.draftMax = r.draft;
      const dt = FM.C.STEP;
      if (S.mode === 'race') for (let i = 0; i < R.length; i++) {
        const r = R[i];
        if (r.finished || r.out) continue;
        if (r.frozen > 0) lost.donma += dt; else if (r.netted > 0) lost.ag += dt; else if (r.stun > 0) lost.sersem += dt;
        if (r.slowT > 0) lost.yavas += dt; if (r.pull > 0) lost.cekilme += dt; if (r.dead > 0) lost.olu += dt; if (r.spawnT > 0) lost.hazirlik += dt;
        // takılma: canlı, kontrol kaybı yok, 2 sn'de 60 px'ten az ilerleme (tırmanma dahil sayılır: duvar dibinde dikilmek takılmadır)
        // (eşya etkisinden — mıknatısla geri çekilme, savrulma — sonraki 1.5 sn takılma sayılmaz: o, eşyanın işidir)
        const free = r.dead <= 0 && !(r.frozen > 0) && !(r.netted > 0) && !(r.stun > 0) && !(r.spawnT > 0) && !(r.pull > 0) && !(S.raceT - (r.lastHitT == null ? -9 : r.lastHitT) < 1.5);
        if (!free || r.x > win[i].x + 60) { win[i].x = r.x; win[i].t = t; }
        else if (t - win[i].t > 2) { lost.takili += dt; if (t - win[i].t < 2 + dt * 1.5) stuckEv++; }
      }
      // havada kalan nesne: tuzak/ağ yere oturmuşsa altında katı olmalı; uçuşta 4 sn'den uzun kalmamalı
      for (const e of S.ents) {
        if (e.type !== 'trap' && e.type !== 'net') continue;
        if (e.fly) { const ft = (flyT.get(e) || 0) + dt; flyT.set(e, ft); if (ft > 4 && !floatSeen.has(e)) { floatSeen.add(e); floating++; } continue; }
        const cx = e.x + e.w / 2, by = e.y + e.h;
        if (!(FM.game.solidAt(cx, by + 1) && !FM.game.solidAt(cx, by - 2)) && !floatSeen.has(e)) { floatSeen.add(e); floating++; }
      }
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
const sortObj = o => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
console.log('Eşya kullanımı (yön):', sortObj(aimUse));
console.log('Varlıkla öldürme (yön):', sortObj(aimKill));
console.log('Güç kullanımı (yön):', sortObj(abUse));
console.log('His:', JSON.stringify(feel));
const per = v => (v / Math.max(1, N) / NR).toFixed(2);
console.log('Zaman kaybı (yarışçı başına sn):', JSON.stringify(Object.fromEntries(Object.entries(lost).map(([k, v]) => [k, +per(v)]))), ' takılma olayı', stuckEv);
console.log('Eşya sonuçları (kul → isabet/öldür/kayıp):', Object.entries(itemOut).sort().map(([k, o]) => `${k} ${o.kul}→${o.isabet}/${o.oldur}/${o.kayip}`).join('  '));
console.log('Engel/çevre ölümleri (yarış başına):', Object.entries(envDeath).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / Math.max(1, N)).toFixed(2)}`).join('  '));
console.log('Güç sonuçları (kul → isabet):', Object.entries(abOut).sort().map(([k, o]) => `${k} ${o.kul}→${o.isabet}${o.kapma != null ? ' kapma ' + o.kapma : ''}`).join('  '));
console.log('Havada kalan nesne:', floating, floating ? '  !! tuzak/ağ havada kaldı' : '(0 olmalı)');
