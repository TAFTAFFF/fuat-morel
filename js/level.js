/* FUAT MOREL — level.js : harita üretimi (yalnızca veri). */
'use strict';
(function (FM) {
  const { clamp } = FM;

  /* Seviye veri yapısı (renderer'lar bunu okur):
     theme     : FM.THEMES öğesi
     solids    : [{x,y,w,h,float?}]       zemin blokları (y = üst yüzey). float=true -> havada platform (h=22)
     spikes    : [{x,y,w,h}]              yer dikenleri (her 36 px bir diken), y = diken tepesi
     crush     : [{x,y,w,h}]              tavandan sarkan ezici. ÖLDÜREN bölge {x,y,w,h}; alt kenarı (y+h) zeminin 26 px üstü
     saws      : [{cx,cy,r,amp,sp,ph,px,py}] dikey salınan testere makinesi (px,py anlık merkez)
     boxes     : [{x,y,w,h,cd:[4]}]        eşya kutuları (her yarışçı için ayrı bekleme süresi cd[idx])
     pads      : [{x,y,w}]                 hız pedi (y = zemin üstü)
     mush      : [{x,y,w,sq}]              zıplatan mantar (y = zemin üstü, sq>0 iken ezilme animasyonu)
     belts     : [{x,y,w}]                 ileri iten yürüyen bant
     mud       : [{x,y,w}]                 yavaşlatan çamur
     coins     : [{x,y,got}]               altın (merkez x,y). got = bit maskesi: (got & (1<<racer.idx)) ise o yarışçı almış.
                                           Ekranda yalnızca OYUNCUNUN almadıkları çizilir.
     decor     : [{x,y,type,layer:'back'|'front',s,flip,seed}]  süs (çarpışmasız). y = zemin üstü (taban noktası)
     liq       : sıvı yüzeyinin y'si (çukurlarda görünen su/lav/çikolata). Düşen yarışçı burada ölür.
     start     : başlangıç çizgisi x, startY: başlangıç zemini y
     end       : bitiş çizgisi x, finY: bitiş zemini y
     len       : toplam genişlik
  */
  FM.genLevel = function (rd, opts) {
    opts = opts || {};
    const seed = opts.seed != null ? opts.seed : ((Math.random() * 1e9) | 0);
    const rnd = FM.mulberry32(seed);
    const R = (a, b) => a + rnd() * (b - a), I = (a, b) => Math.floor(R(a, b + 1));
    const theme = opts.theme != null ? FM.THEMES[opts.theme % FM.THEMES.length] : FM.THEMES[(rd - 1 + FM.S.themeOff) % FM.THEMES.length];
    const L = { theme, seed, solids: [], spikes: [], crush: [], saws: [], boxes: [], pads: [], mush: [], belts: [], mud: [], coins: [], decor: [], liq: 600, start: 60, startY: 460, end: 0, finY: 460, len: 0 };
    let x = 0, gy = 460, prev = '';
    const BOX_GAP = 2400;   // kutular arası en az mesafe: yarışçı başına yarışta ~5-6 eşya (çok sık olunca yarış kaosa dönüyor)
    let lastBox = 1200 - BOX_GAP;   // ilk kutu ~1200. px'ten sonra (başlangıç eşyası kilidi bittikten sonra)
    const ground = w => { L.solids.push({ x, y: gy, w, h: 1500 - gy }); const s = x; x += w; return s; };
    const box = (bx, by) => { L.boxes.push({ x: bx - 16, y: by - 16, w: 32, h: 32, cd: [0, 0, 0, 0] }); lastBox = bx; };
    const coinRow = (x0, y0, n, dx) => { for (let i = 0; i < n; i++) L.coins.push({ x: x0 + i * dx, y: y0, got: 0 }); };
    const coinArc = (x0, x1, y0, h, n) => { for (let i = 0; i < n; i++) { const t = n === 1 ? .5 : i / (n - 1); L.coins.push({ x: x0 + (x1 - x0) * t, y: y0 - Math.sin(t * Math.PI) * h, got: 0 }); } };
    ground(700);
    const len = opts.len || 15500;
    const pool = ['flat', 'pad', 'gap', 'gap', 'step', 'wall', 'drop', 'spikes', 'spikes', 'crush', 'crush', 'belt', 'route', 'route', 'plat', 'saw'];
    while (x < len) {
      let t = pool[I(0, pool.length - 1)];
      const afterRoute = prev === 'route';
      if (t === prev && t !== 'gap') t = 'flat';
      if (['route', 'drop', 'plat', 'wall', 'step', 'gap'].includes(prev) && ['spikes', 'crush', 'saw'].includes(t)) t = 'flat';
      // route'un yüksek platformundan inen yarışçı doğrudan çukura/basamağa düşmesin: route'tan sonra hep geniş düz zemin
      if (afterRoute) t = 'flat';
      if (t === 'wall' && gy < 300) t = 'drop';
      if (t === 'drop' && gy > 420) t = 'step';
      prev = t;
      // kutu merkezi zeminden 50 px yukarıda: koşarken başa değer (zıplayınca üstünden aşılmaz); kutular seyrek
      if (x - lastBox > BOX_GAP && t !== 'route') { const w = afterRoute ? R(380, 460) : R(260, 340), s = ground(w); box(s + w / 2, gy - 50); continue; }
      switch (t) {
        case 'flat': { const w = afterRoute ? R(380, 460) : R(260, 420), s = ground(w); if (rnd() < .45) coinRow(s + w / 2 - 60, gy - 36, 5, 30); break; }
        case 'pad': { const w = R(420, 560), s = ground(w); L.pads.push({ x: s + w * .35, y: gy, w: 120 }); coinRow(s + w * .35 + 150, gy - 36, 4, 32); break; }
        case 'gap': { const gw = R(100, 170), gx = x; x += gw; coinArc(gx - 30, gx + gw + 30, gy - 60, 70, 5); ground(R(260, 380)); break; }
        case 'step': {
          const o = [-40, -90, -120, 60, 110].filter(d => gy + d >= 220 && gy + d <= 520);
          // duvardan sonra zemin çok yüksekte (gy < 110) kalınca hiçbir seçenek uymuyordu → gy NaN, haritanın geri kalanı bozuluyordu
          if (o.length) gy += o[I(0, o.length - 1)]; else gy = clamp(gy + 110, 220, 520);
          ground(R(300, 420)); break;
        }
        case 'wall': { gy -= I(160, 220); ground(R(380, 520)); break; }
        case 'drop': { gy = Math.min(520, gy + I(110, 200)); ground(R(300, 420)); break; }
        case 'spikes': {
          const w = R(500, 640), s = ground(w);
          const x1 = s + w * .3, w1 = 36 * I(1, 3);
          L.spikes.push({ x: x1, y: gy - 26, w: w1, h: 26 });
          if (rnd() < .5) {
            // ikinci diken birincinin SONUNA göre: arada iki ayrı zıplamaya yetecek 170-240 px boşluk
            const w2 = 36 * I(1, 2);
            let x2 = x1 + w1 + R(170, 240);
            if (x2 + w2 > s + w - 80) x2 = s + w - 80 - w2;
            if (x2 - (x1 + w1) >= 165) L.spikes.push({ x: x2, y: gy - 26, w: w2, h: 26 });
          }
          break;
        }
        case 'crush': {
          const w = R(520, 660), s = ground(w), n = I(1, 2);
          for (let i = 0; i < n; i++) { const cw = R(50, 90); L.crush.push({ x: s + w * (n === 1 ? .45 : .3 + i * .38), y: gy - 300, w: cw, h: 300 - 26 }); }
          break;
        }
        case 'belt': { const w = R(560, 760), s = ground(w); L.belts.push({ x: s + 60, y: gy, w: w - 120 }); break; }
        case 'route': {
          const w = R(820, 980), s = ground(w);
          L.mush.push({ x: s + 60, y: gy, w: 54, sq: 0 });
          L.mud.push({ x: s + 180, y: gy, w: w - 260 });
          const py = gy - 190;
          L.solids.push({ x: s + 200, y: py, w: 300, h: 22, float: true });
          L.solids.push({ x: s + 560, y: py - 30, w: w - 620, h: 22, float: true });
          L.pads.push({ x: s + 260, y: py, w: 120 });
          if (s + 620 - lastBox > BOX_GAP * .6) box(s + 620, py - 80);   // ikinci platformun (py-30) 50 px üstü: koşarken alınır
          coinRow(s + 400, py - 36, 3, 30); coinRow(s + 680, py - 66, 5, 30);
          break;
        }
        case 'plat': {
          let py = gy; const n = I(2, 3);
          for (let i = 0; i < n; i++) {
            x += R(90, 130);
            const ny = clamp(py + R(-50, 45), 200, gy + 10), pw = R(100, 140);
            L.solids.push({ x, y: ny, w: pw, h: 22, float: true });
            coinRow(x + pw / 2 - 30, ny - 36, 3, 30);
            x += pw; py = ny;
          }
          x += R(90, 120); ground(R(280, 380)); break;
        }
        case 'saw': {
          const w = R(560, 680), s = ground(w);
          // amp 36: bıçağın en alt noktası (merkez zeminden 44 px yukarıda) kayan yarışçıya hiç değmez → "kayarsan hep geçersin"
          // (cy = zemin - 80 ilişkisi korunur: render-world makinenin tabanını cy + 80'e çizer)
          L.saws.push({ cx: s + w / 2, cy: gy - 80, r: 28, amp: 36, sp: R(1.6, 2.2), ph: rnd() * 6.28, px: s + w / 2, py: gy - 80 });
          break;
        }
      }
    }
    const s = ground(1400);
    L.end = s + 560; L.finY = gy; L.len = x;
    // güvenlik ağı: sayısal olarak bozuk bir harita (NaN/sonsuz) asla oyuna gitmesin
    const okNum = o => isFinite(o.x) && isFinite(o.y) && isFinite(o.w);
    if (!L.solids.every(okNum) || !isFinite(L.end) || !isFinite(L.finY)) {
      if (!opts._retry || opts._retry < 5) return FM.genLevel(rd, Object.assign({}, opts, { seed: (seed + 7919) | 0, _retry: (opts._retry || 0) + 1 }));
    }

    /* ---- dekor üretimi ---- */
    const set = FM.DECOR[theme.id] || FM.DECOR.forest;
    const busy = [];
    const mark = (a, b) => busy.push([a, b]);
    for (const o of L.spikes) mark(o.x - 50, o.x + o.w + 50);
    for (const o of L.crush) mark(o.x - 60, o.x + o.w + 60);
    for (const o of L.saws) mark(o.cx - 90, o.cx + 90);
    for (const o of L.pads) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.mush) mark(o.x - 40, o.x + o.w + 40);
    for (const o of L.belts) mark(o.x - 30, o.x + o.w + 30);
    for (const o of L.mud) mark(o.x - 20, o.x + o.w + 20);
    for (const o of L.boxes) mark(o.x - 30, o.x + o.w + 30);
    mark(L.start - 80, L.start + 160); mark(L.end - 120, L.end + 200);
    const free = (a, b) => !busy.some(([p, q]) => a < q && b > p);
    let ds = 1;
    for (const sd of L.solids) {
      if (sd.float) continue;
      let px = sd.x + R(30, 90);
      while (px < sd.x + sd.w - 40) {
        const backTurn = rnd() < .38;
        const type = backTurn ? set.back[I(0, set.back.length - 1)] : set.front[I(0, set.front.length - 1)];
        const half = backTurn ? 46 : 18;
        if (px - half > sd.x + 6 && px + half < sd.x + sd.w - 6 && (backTurn || free(px - half, px + half))) {
          // arka dekor (ağaç vb.) yarışçının arkasında kalır; ön dekor küçük süs
          L.decor.push({ x: px, y: sd.y, type, layer: backTurn ? 'back' : 'front', s: backTurn ? R(.85, 1.25) : R(.8, 1.2), flip: rnd() < .5, seed: (seed + ds++ * 7919) | 0 });
        }
        px += backTurn ? R(150, 320) : R(60, 170);
      }
    }
    return L;
  };
})(window.FM);
