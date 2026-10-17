/* =======================================================================
   FUAT MOREL — İlk deneyim: hoş geldin ekranı + öğretici antrenman yarışı (koç)
   Yeni oyuncu (hiç yarış yapmamış) ilk açılışta karşılanır ve kısa bir antrenman yarışına alınır.
   Koç, motorun FM.S.hint ipucunu (sıradaki engelde zıpla/kay/tırman/çift zıpla) izler: engel yaklaşınca zaman
   yavaşlar (FM.slowMo), ekranda büyük komut ve düğmeyi gösteren el çıkar; oyuncu doğru tuşa basınca zaman açılır.
   Eşya kutusu alınca ve özel güç dolunca da bir kez anlatılır. Her adım bir kez öğretilir; oyuncu takılmasın diye
   her adım en çok birkaç saniye bekler. Tek oyunculu yarışta çalışır (ağ maçında FM.slowMo etkisizdir).
   Yardım ekranından ya da FM.tut.start() ile yeniden oynanabilir. Kayıtta: FM.save.tut = 1 (bitti/atlandı).
   ======================================================================= */
(function () {
  'use strict';
  const FM = window.FM;
  const T = FM.tut = { active: false };
  const sv = () => FM.save || {};
  const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const touch = () => !!(FM.ui && typeof FM.ui.isTouch === 'function' && FM.ui.isTouch());
  const persist = () => { try { if (typeof FM.persist === 'function') FM.persist(true); } catch (e) { /* yok say */ } };
  FM.slowMo = 1;

  // öğretilecek adımlar: başlık, dokunmatik/klavye açıklaması, gösterilecek düğme
  const STEPS = {
    jump:  { t: 'ZIPLA!', sT: '↑ düğmesine dokun', sK: 'BOŞLUK ya da ↑ tuşuna bas', btn: 'jump' },
    dbl:   { t: 'ZIPLA!', sT: 'Geniş çukur: zıpla, havada ↑ düğmesine bir daha dokun', sK: 'Zıpla, havada bir kez daha bas', btn: 'jump', t2: 'BİR DAHA!' },
    climb: { t: 'TIRMAN!', sT: 'Yüksek duvar: ↑ düğmesini basılı tut', sK: 'Yüksek duvar: BOŞLUK\'u basılı tut', btn: 'jump', t2: 'BASILI TUT!' },
    slide: { t: 'KAY!', sT: '↓ düğmesine dokun', sK: '↓ ya da S tuşuna bas', btn: 'slide' },
    item:  { t: 'EŞYAYI AT!', sT: 'Eşya düğmesine dokun. Basılı tutup sürüklersen nişan alırsın', sK: 'E tuşuna bas. Basılı tutup yön verirsen nişan alırsın', btn: 'item' },
    power: { t: 'ÖZEL GÜÇ HAZIR!', sT: 'Güç düğmesine dokun (yanıp sönen)', sK: 'Q ya da F tuşuna bas', btn: 'power' }
  };
  const SLOW = { jump: .1, dbl: .1, climb: .12, slide: .1, item: .28, power: .28 };
  const WAIT = 6500;
  const MOVING = { rollsaw: 1, simit: 1, terlik: 1, trap: 1, net: 1, boulder: 1 };   // hareketli/atılan tehlike: koç bunlarda durdurmaz   // bir adımda en çok bekleme (ms, gerçek zaman; duraklatmada sayılmaz)

  let done = {}, cur = null, stage = 0, curT = 0, lostT = 0, lastT = 0, raf = 0, tgtSlow = 1, finished = false;
  let el = null, elT = null, elS = null, hand = null, flashT = 0;

  /* ---------- görünüm ---------- */
  function ensureDom() {
    if (el) return;
    el = document.createElement('div'); el.className = 'tut-coach'; el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<b class="tut-t"></b><span class="tut-s"></span>';
    elT = el.querySelector('.tut-t'); elS = el.querySelector('.tut-s');
    hand = document.createElement('div'); hand.className = 'tut-hand'; hand.textContent = '👇';
    document.body.appendChild(el); document.body.appendChild(hand);
  }
  function show(title, sub, cls) {
    ensureDom();
    elT.textContent = title || ''; elS.textContent = sub || '';
    el.className = 'tut-coach on' + (cls ? ' ' + cls : '');
  }
  function hide() { if (el) el.className = 'tut-coach'; pointAt(null); }
  function pointAt(btn) {
    if (!hand) return;
    const b = btn && touch() ? document.querySelector('.tbtn[data-tc="' + btn + '"]') : null;
    const r = b && b.getBoundingClientRect();
    if (!r || !r.width) { hand.className = 'tut-hand'; return; }
    hand.style.left = (r.left + r.width / 2) + 'px';
    hand.style.top = (r.top - 8) + 'px';
    hand.className = 'tut-hand on';
  }
  function flash(title, ms, cls) { show(title, '', 'tut-ok ' + (cls || '')); pointAt(null); flashT = nowMs() + (ms || 900); }

  /* ---------- adımlar ---------- */
  function begin(k) {
    const d = STEPS[k]; if (!d) return;
    cur = k; stage = 0; curT = 0; lostT = 0; tgtSlow = SLOW[k] || .15;
    show(d.t, touch() ? d.sT : d.sK);
    pointAt(d.btn);
    if (FM.audio && typeof FM.audio.play === 'function') { try { FM.audio.play('select'); } catch (e) { /* yok say */ } }
  }
  function complete(ok, free) {
    const k = cur; if (!k) return;
    cur = null; tgtSlow = 1;
    if (ok) { done[k] = 1; flash(['SÜPER!', 'HARİKA!', 'AYNEN BÖYLE!'][(Object.keys(done).length - 1) % 3], 850); }
    else { if (!free) done[k] = (done[k] || 0) + .5; hide(); }   // kaçırdı/takıldı: bir kez daha denenir, sonra geçilir
  }
  const P = () => FM.S && FM.S.player;
  const mine = d => d && d.r && d.r === P();

  FM.on('go', () => { if (T.active) { show('KOŞ!', 'Karakterin kendisi koşar. Sen engelleri aş!', 'tut-info'); flashT = nowMs() + 2600; } });
  FM.on('jump', d => {
    if (!T.active || !mine(d) || !cur) return;
    if (cur === 'jump') complete(true);
    else if (cur === 'dbl') { if (d.dbl) complete(true); else if (stage === 0) { stage = 1; curT = 0; show(STEPS.dbl.t2, touch() ? 'Havadayken ↑ düğmesine tekrar dokun' : 'Havadayken tekrar bas'); } }
    else if (cur === 'climb' && stage === 0) { stage = 1; curT = 0; tgtSlow = .35; show(STEPS.climb.t2, touch() ? 'Duvara değince ↑ düğmesini bırakma' : 'Duvara değince tuşu bırakma'); }
  });
  FM.on('climb', d => { if (T.active && mine(d) && cur === 'climb') complete(true); });
  FM.on('slide', d => { if (T.active && mine(d) && cur === 'slide') complete(true); });
  FM.on('box', d => { if (T.active && mine(d) && d.item && !done.item && !cur) begin('item'); });
  FM.on('item:use', d => { if (T.active && mine(d)) { if (cur === 'item') complete(true); else done.item = 1; } });
  FM.on('charge:full', d => { if (T.active && mine(d) && !done.power && !cur) begin('power'); });
  FM.on('ability', d => { if (T.active && mine(d)) { if (cur === 'power') complete(true); else done.power = 1; } });
  FM.on('death', d => { if (T.active && d && d.r === P() && cur) complete(false); });
  FM.on('finish', d => {
    if (!T.active || !mine(d)) return;
    finished = true; cur = null; tgtSlow = 1;
    show(d.place === 0 ? 'BİRİNCİ OLDUN!' : 'BİTİRDİN!', 'Antrenman tamam. Artık gerçek yarışlara hazırsın!', 'tut-ok tut-end');
    pointAt(null); flashT = nowMs() + 3200;
  });
  FM.on('match:end', () => { if (T.active) end(true); });
  FM.on('ui:menu', () => { if (T.active) end(finished); });

  /* ---------- kare döngüsü (yalnızca antrenmanda) ---------- */
  function tick() {
    raf = 0;
    if (!T.active) return;
    raf = requestAnimationFrame(tick);
    const t = nowMs(), dt = Math.min(100, t - (lastT || t)); lastT = t;
    const S = FM.S;
    // zaman ölçeği yumuşak geçsin (ani donma/fırlama olmasın)
    FM.slowMo += (tgtSlow - FM.slowMo) * Math.min(1, dt / (tgtSlow < FM.slowMo ? 70 : 140));
    if (Math.abs(FM.slowMo - tgtSlow) < .01) FM.slowMo = tgtSlow;
    if (!S || S.mode !== 'race' || S.paused) return;
    if (cur) {
      curT += dt;
      if (STEPS[cur].btn) pointAt(STEPS[cur].btn);
      if (curT > WAIT) complete(false);
      // engel ortadan kalktı (atılan testere geçti, yol değişti): yavaşlatma hemen biter, adım sayılmaz
      else if (stage === 0 && cur !== 'item' && cur !== 'power') {
        const h = S.hint;
        lostT = h && h.act === cur ? 0 : lostT + dt;
        if (lostT > 300) complete(false, true);
      }
      return;
    }
    if (flashT && t > flashT) { flashT = 0; hide(); }
    if (finished) return;
    const h = S.hint, p = P();
    if (h && STEPS[h.act] && (done[h.act] || 0) < 1 && !MOVING[h.kind] && p && !(p.dead > 0) && !p.finished) {
      const lead = h.act === 'dbl' ? .42 : h.act === 'climb' ? .5 : .45;
      if (h.eta <= lead && (p.onGround || h.act === 'slide')) begin(h.act);
    }
  }

  /* ---------- başlat / bitir ---------- */
  /** Antrenman yarışını başlat (ilk deneyim ya da yardım ekranından yeniden) */
  T.start = function (char) {
    if (!FM.game || typeof FM.game.startMatch !== 'function') return false;
    done = {}; cur = null; stage = 0; finished = false; flashT = 0; tgtSlow = 1; FM.slowMo = 1;
    T.active = true;
    if (FM.S) FM.S.tutorial = true;   // motor: kolay botlar, sabit kolay pist (destekliyorsa)
    const opts = { char: char || sv().selChar, rounds: 1, mode: 'classic', theme: 0, n: 4, seed: 7 };
    if (FM.ui && typeof FM.ui.startMatch === 'function') FM.ui.startMatch(opts); else FM.game.startMatch(opts);
    lastT = 0; if (!raf) raf = requestAnimationFrame(tick);
    return true;
  };
  function end(ok) {
    T.active = false; cur = null; tgtSlow = 1; FM.slowMo = 1;
    if (FM.S) FM.S.tutorial = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    hide();
    const s = sv(), first = s.tut !== 1;
    s.tut = 1; persist();
    // ilk antrenmanı bitirene küçük hoş geldin ödülü (bir kez)
    if (ok && first && FM.meta && typeof FM.meta.add === 'function' && !s.tutGift) {
      s.tutGift = 1;
      FM.meta.add('coins', 300, 'tutorial'); FM.meta.add('gems', 5, 'tutorial');
      persist();
      setTimeout(() => { if (FM.ui && FM.ui.note) FM.ui.note({ title: 'Antrenman ödülü!', sub: '+300 altın · +5 elmas. Şimdi arkadaşlarınla yarış!', cls: 'n-ok', ms: 3200 }); }, 900);
    }
  }
  T.stop = () => end(false);
  T._dbg = () => ({ done: Object.assign({}, done), cur, stage, finished, flashT, raf, slow: FM.slowMo, tgtSlow });

  /* ---------- hoş geldin (yalnızca yeni oyuncu) ---------- */
  /** Hoş geldin gösterilmeli mi: hiç yarış yapmamış, antrenmanı görmemiş, oda linkiyle gelmemiş */
  T.want = function () {
    const s = sv(), p = FM.params || {};
    if (p.tut === '1' || p.tut === 1) return true;   // geliştirici: ?tut=1
    if (FM.DEV || s.tut === 1 || p.oda) return false;
    const races = s.stats && +s.stats.races || 0;
    if (races > 0) { s.tut = 1; persist(); return false; }   // eski oyuncu: hiç gösterme
    return true;
  };
  T.welcome = function () {
    if (document.querySelector('.tut-wel')) return;
    const w = document.createElement('div');
    w.className = 'tut-wel';
    w.innerHTML =
      '<div class="tw-box">' +
        '<div class="tw-logo">FUAT<br>MOREL</div>' +
        '<p class="tw-t">Hoş geldin!</p>' +
        '<p class="tw-s">Mahallenin en çılgın yarışına hazır mısın? Önce 1 dakikalık bir antrenman koşusu yapalım: zıplamayı, kaymayı ve eşya atmayı göstereceğiz.</p>' +
        '<button class="btn b-green tw-go" type="button"><span>HADİ BAŞLA!</span></button>' +
        '<button class="tw-skip" type="button">Bu oyunu biliyorum, atla</button>' +
      '</div>';
    document.body.appendChild(w);
    const close = () => { w.classList.add('out'); setTimeout(() => w.remove(), 260); };
    w.querySelector('.tw-go').addEventListener('click', () => { close(); T.start(); });
    w.querySelector('.tw-skip').addEventListener('click', () => { close(); sv().tut = 1; persist(); if (FM.emit) FM.emit('ui:menu', {}); });
  };
})();
