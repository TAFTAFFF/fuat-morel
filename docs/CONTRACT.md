# FUAT MOREL — Modül Sözleşmesi (tüm ajanlar bunu okumalı)

Fuat Morel, Fun Run 4 tarzı, tarayıcıda oynanan 2D engelli koşu yarışı (2-10 yarışçı; tek oyunculuda varsayılan 4, 5 mod, 8 harita). Oyuncu bir klanın 7 üyesinden birini seçer (TAFTAF, Caner, LUL, ertan, Kral, Nuss, baso), diğerleri bot (7'den fazla yarışçıda karakterler tekrar eder) ya da arkadaşlar (çok oyunculu, docs/MULTIPLAYER.md). Oyun GitHub Pages'te yayınlanacak, telefon ve bilgisayardan oynanacak. **Tüm oyun içi metinler TÜRKÇE** (ç, ğ, ı, İ, ö, ş, ü doğru yazılmalı).

## KALİTE ÇITASI (en önemli kısım)
Kullanıcının tek şikâyeti: **"görünüş kötü"**. Hedef: Fun Run 4'ten daha kaliteli görünen, olabilecek en kaliteli 2D çizgi film görünümü.
- Kalın koyu dış hatlar (cartoon outline), gradyan gölgelendirme, ışık vurguları (highlight), yumuşak gölgeler, derinlik (parallax katmanları, atmosferik pus), canlı ama uyumlu renk paletleri.
- Her şey "elle çizilmiş oyun sanatı" gibi görünmeli: düz renkli kutu/üçgen YOK. Yuvarlatılmış köşeler, eğriler, doku detayları (taş, çimen yaprakları, krema damlaları, kar topakları).
- Animasyon ve "juice": esneme/ezilme, toz bulutları, parıltılar, ekran sarsıntısı, yumuşak geçişler.
- Performans: orta seviye telefonda 60 FPS. Pahalı şeyleri (karmaşık şekiller, gradyanlı objeler, desenler) `FM.gfx.sprite()` ile bir kez çizip önbellekle, her karede `drawImage` ile bas. Sıcak döngülerde `shadowBlur` ve `filter` KULLANMA. Her karede yeni gradyan yaratmak az sayıda (onlarca) olabilir, yüzlerce değil.
- Hata yok: tarayıcı konsolunda tek bir hata bile olmamalı. Tanımsız alanlara karşı korumalı yaz (`r.item && ...`).

## DOSYALAR VE SAHİPLİK
Yükleme sırası (index.html): `core.js → gfx.js → level.js → game.js → meta.js → audio.js → render-world.js → render-chars.js → render-fx.js → render-hud.js → ui.js → main.js`

| Dosya | Sahibi | Ne yapar |
|---|---|---|
| js/core.js | ana ajan (DOKUNMA) | `window.FM`, sabitler, veri tabloları (ITEMS, CH, THEMES, DECOR, COSMETICS), olay sistemi, efekt verisi üreticileri `FM.fx`, kayıt `FM.save` |
| js/gfx.js | ana ajan (DOKUNMA) | çizim yardımcıları `FM.gfx` (sprite önbelleği, yazı, renk) |
| js/level.js | ana ajan (DOKUNMA) | `FM.genLevel()` harita verisi |
| js/game.js | ana ajan (DOKUNMA) | fizik, eşyalar, güçler, yapay zekâ, yarış akışı `FM.game` |
| js/main.js | ana ajan (DOKUNMA) | tuval, döngü, kamera, çizim sırası, klavye, geliştirici modu |
| index.html | ana ajan (DOKUNMA) | iskelet: `<canvas id="game">`, `<div id="ui">`, script etiketleri, Google Fonts (Lilita One, Fredoka) |
| js/meta.js | meta ajanı | para/elmas, XP/seviye, görevler, başarımlar, geliştirmeler, kozmetik satın alma, günlük ödül |
| js/audio.js | ses ajanı | WebAudio ile prosedürel efekt sesleri + tema müzikleri |
| js/render-world.js | dünya ajanı | gökyüzü/parallax arka plan, zemin, sıvı, dekor, tehlikeler, kutular, altınlar, başlangıç/bitiş, ön plan, ortam parçacıkları |
| js/render-chars.js | karakter ajanı | 7 karakterin yüksek kaliteli çizimi, animasyon pozları, kozmetik (skin), gölge, isim plakası, portreler |
| js/render-fx.js | efekt ajanı | parçacıklar, halkalar, varlıklar (testere, dinamit, füze...), iz efektleri (trail), ekran efektleri (mürekkep, flaş, vinyet, hız çizgileri) |
| js/render-hud.js | HUD ajanı | yarış içi HUD, geri sayım, kürsü (podium) sahnesi, eşya ikonları `FM.R.itemIcon`, altın ikonu |
| js/ui.js + css/style.css | arayüz ajanı | tüm DOM ekranları (menü, karakter seçimi, mağaza, görevler, klan, ayarlar, nasıl oynanır, duraklatma, sonuçlar), dokunmatik kontroller |

**Kural:** Yalnızca kendi dosyalarını yaz. Başka dosyada değişiklik gerekiyorsa son raporunda `İSTEKLER:` başlığıyla yaz; ana ajan entegre eder. Başka modüllerin fonksiyonlarını çağırırken `typeof FM.R.x === 'function'` ile koru (o modül henüz yazılmamış olabilir).

## ASIL PLATFORM: TELEFON (YATAY)
Arkadaşlar oyunu TELEFONDA oynayacak (link tarayıcıda açılıyor). Her şey önce telefona göre tasarlanmalı: dokunmatik düğmeler, büyük okunaklı yazılar, ~844×390 / 932×430 / 2400×1080 ekranlar, orta seviye telefonda akıcı performans. `FM.isTouch` (core.js) dokunmatik cihazı belirtir; masaüstünde test için `?mobile=1`. Kısa ekranlarda (telefon) main.js kamerayı yakınlaştırır: `FM.view.VH = 440` (masaüstünde 540) — sabit 540 KULLANMA, her zaman `FM.view.VH` / `FM.view.VW` kullan.

## KOORDİNATLAR VE DÖNÜŞÜMLER
- Mantıksal birimler. Görünen dünya yüksekliği `FM.view.VH` (masaüstü 540, telefon 440). Genişlik `FM.view.VW` (ekran oranına göre, ~960 ile ~1300 arası; telefonda daha geniş olabilir).
- `FM.view.S` = cihaz pikseli / mantıksal birim. `FM.view.dpr`.
- main.js çizim sırası ve her çağrıdan ÖNCE ayarladığı dönüşüm:
  1. `FM.R.drawBackground(ctx)` → dönüşüm `scale(S)` (EKRAN koordinatı, 0..VW × 0..VH). Kamera: `FM.S.cam.x, FM.S.cam.y`.
  2. `FM.R.drawWorldBack(ctx)` → DÜNYA koordinatı (main `scale(S)` + `translate(-cam.x, -cam.y)` + sarsıntı yaptı)
  3. `FM.R.drawEnts(ctx)` → dünya
  4. `FM.R.drawRacers(ctx)` → dünya
  5. `FM.R.drawParticles(ctx)` → dünya
  6. `FM.R.drawWorldFront(ctx)` → dünya
  7. `FM.R.drawScreenFX(ctx)` → ekran (`scale(S)`)
  8. `FM.R.drawHUD(ctx)` → ekran — sadece mode ∈ {count, race, end}
  9. `FM.R.drawPodium(ctx)` → ekran — sadece mode = podium (tüm ekranı kaplayan sahne)
- Her fonksiyon değiştirdiği ctx durumunu geri almalı (`save/restore`), çıkışta `globalAlpha=1`, `globalCompositeOperation='source-over'`.
- Görünür dünya aralığı: x ∈ [cam.x, cam.x+VW], y ∈ [cam.y, cam.y+VH]. Ekran dışını çizme (kırp).
- `FM.R.updaters.push(fn)` → `fn(dt)` her karede (gerçek dt, saniye) çağrılır; animasyon/parçacık güncellemesi için.
- `FM.R.resize()` (opsiyonel, tek bir dosya tanımlarsa diğerlerini ezer — bunun yerine `FM.on('resize', fn)` kullan). Ekran ölçeği değişince `FM.gfx` önbelleği otomatik temizlenir.

## DURUM: `FM.S`
```
mode: 'demo' | 'count' | 'race' | 'end' | 'podium' | 'menu'
   demo  = menü arkasında 4 botla dönen tanıtım yarışı (HUD çizilmez)
   count = 3-2-1 geri sayım (S.countT: kalan sn; sayı = ceil(countT-.6), 0 ise "HAZIR/KOŞ")
   race  = yarış; end = tur bitti (1.5 sn); podium = kürsü sahnesi + sonuç paneli
L: seviye (aşağıda)    racers: [2..10 yarışçı; tek oyunculuda varsayılan 4]   player: oyuncunun yarışçısı (demoda racers[0])
ents: varlıklar   parts: parçacıklar   rings: halkalar   toasts: [{m,t,max,col}]   feed: [{a,icon,b,t}] (öldürme akışı)
T: toplam zaman   raceT: yarış süresi   countT   endTimer (null veya kalan sn)   finishedN
round, ROUNDS   cam:{x,y}   shake (0..~.4)   flash:{a,col}   paused   lastResult (son tur sonucu)   podiumT (kürsü süresi)
gameMode: 'classic'|'elim'|'coins'|'pure'|'chaos' (FM.MODES)   themeSeq: [tur başına tema indeksi]
lt: seviye saati (tur başında 0; testere/kaya/gayzer döngüleri buna bağlı)   limitT: süre sınırı sn (Altın Avı 75, yoksa null; kalan = FM.game.timeLeft())
spec: oyuncu elendiyse kameranın izlediği yarışçı (yoksa null)   elimN: elenen sayısı   netRole: null | 'host' | 'member' (ağ; 'member' dünya kararı vermez)
```

### Yarışçı (racer) alanları
```
id ('TAFTAF'...), name, idx (0..9; kutu cd[idx] ve altın biti 1<<idx), bot (bool), x,y (sol-üst), w=28, h (42 ayakta / 22 kayarken), vx, vy
onGround, jumps (0/1/2), slide, climb, slam, fly (>0 süzülüyor, Nuss), dash (>0 atılım, TAFTAF), sled (>0 kızak, ertan)
item (FM.ITEMS anahtarı | null), charge (0..100 özel güç), boost (>0 hızlı), shield (>0), balloon (bool), padT (>0 hız pedi)
dead (>0 ölü — ÇİZME), inv (>0 dokunulmaz; 0<inv<100 iken yanıp sön), stun, frozen (buz bloğu içinde), netted (ağda), slowT (yavaş, nota efekti), pull (mıknatıs), inked
finished, place, ftime, rp (tur puanı), total, deaths, kills, coins, td (oyuncunun kupa değişimi)
ph (animasyon fazı, koşarken artar), land (0..1 inişte ezilme, azalır), jumpT (0..1 zıplamada esneme, azalır), face (1 = sağa)
skin ('klasik'|'altin'|'gece'|'neon'|'buz'), trail (FM.COSMETICS.trails id), plate (FM.COSMETICS.plates id)
abLv (özel güç seviyesi), chargeMul
nick (görünen ad; aynı karakterden birden çok yarışçıda name/nick "Kral 2"), ctrl ('local'|'bot'|'remote'), pid (ağ kimliği | null)
out (bool: ELENDİ → izleyici; dead=1e9 tutulur, çizilmez), elim (= out, ağ alanı), outN (kaçıncı elenen), outT, gates (geçilen kapı bit maskesi)
tp (ışınlanma sayacı: yeniden doğma/portal → ara değerleme kaydırmasın), onIce, onSand (bataklık kum), inLift (rüzgâr bacasında), bounceT (trambolin/gayzer fırlatması)
```
Ayaklar `y+h`'de, gövde merkezi `x+14`. Karakter görseli çarpışma kutusundan en fazla ~1.3 kat büyük çizilebilir (Fun Run gibi okunaklı olsun, 1.2-1.3 öneriliyor).

### Seviye `FM.S.L`
level.js başındaki açıklamaya bak. Özet: `theme {id,n,liquid,sky}`, `solids [{x,y,w,h,float?}]`, `spikes`, `crush` (tavandan sarkan ezici: öldüren bölge {x,y,w,h}, alt kenar zeminin 26 px üstü; zincir yukarı doğru ekran dışına uzanmalı), `saws [{cx,cy,r,amp,sp,ph,px,py}]` (dikey salınan testere makinesi; ray cx'te cy±amp), `boxes [{x,y,w,h,cd}]` (oyuncunun `cd[player.idx]>0` iken soluk/yok göster), `pads`, `mush [{x,y,w,sq}]`, `belts`, `mud`, `coins [{x,y,got}]` (`got & (1<<player.idx)` ise çizme), `decor [{x,y,type,layer,s,flip,seed}]`, `liq` (sıvı yüzeyi y=600, `theme.liquid` ∈ water/chocolate/icewater/lava/quicksand/plasma/neon), `start` (x=60, startY), `end` (bitiş çizgisi x), `finY`.
Yeni (hepsi her zaman dizi): `mode`, `ice [{x,y,w}]` (kaygan buz, kar), `quicksand [{x,y,w}]` (bataklık kum, çöl), `boulders [{x0,x1,y,r,...,bx,by,st,k,rot}]` (yuvarlanan kaya, çöl), `vents [{x,y,w,h,kind:'lift'|'burst',per,on,ph,act,k}]` (rüzgâr bacası/gayzer), `portals [{ax,ay,bx,by,r,h}]` (ışınlanma, uzay), `lowg [{x,w}]` (düşük yerçekimi, uzay), `tramp [{x,y,w,sq}]` (trambolin, şehir), `bridges [{x,y,w}]` (sallanan köprü, tropik; tabanı solids'te `{float,bridge}`), `gates [{x,y,n,off,pass,done}]` (eleme kapısı). Altın Avı'nda ölümde düşen altınlar `coins`'e `{drop:true,v,id,t,...}` olarak eklenir. Ayrıntı ve çizim sözleşmesi: level.js başı + docs/MULTIPLAYER.md "Uygulama Notları → Motor".
Zemin blokları yüzeyden y=1500'e kadar uzanır; sıvı (liq=600) çukurlarda görünür. Görünür alanın altı (cam.y+VH) en fazla ~690.

### Varlıklar `FM.S.ents` (type alanına göre)
```
saw  {x,y,vx,vy,r=15,o,age,life,b}       atılan dönen testere (yerde yuvarlanır)
dyn  {x,y,vx,vy,age,fuse}                 fırlatılan dinamit (fitil kıvılcımı)
trap {x,y,w=34,h=12,age,life}             ayı tuzağı, age>.5 kurulu
net  {x,y,w=44,h=76,age,life,n}           elektrik ağı, age>.6 aktif
mis  {x,y,vx,vy,tgt,o,age,warn}           füze; age<warn iken sahibinin üstünde bekler ve hedefte (tgt) kırmızı nişangâh göster
bolt {tgt,t,age}                          hedefin ~70 px üstünde kara bulut, t = kalan sn
flash{strike(x),sy,flash,tgt}             yıldırım çakması (flash = kalan süre ~.3)
mag  {o,t}                                mıknatıs şarjı (sahibinin etrafında)
crow {x,y,tgt,fx,age,ph}                  Caner'in kargaları (fx = yön)
wave {x,y,life,age}                       baso'nun ses dalgası (sağa ilerleyen)
meteor {x,y,t,max,r,age}                  Kaos meteoru: (x,y) iniş noktası (zemin üstü); t = inişe kalan sn (max'tan 0'a). Yerde büyüyen uyarı gölgesi, son ~0.5 sn gökten düşen kaya. r = öldürme yarıçapı
```
`o` = sahibi yarışçı.

### Parçacıklar `FM.S.parts`
`{k, x, y, vx, vy, life, max, c (renk), s (boyut), g (yerçekimi), rot, vr, drag, add (true = 'lighter' karışım), str (text için)}`
k ∈ `dot | puff | spark | conf | glow | star | note | heart | spade | ice | leaf | text`. render-fx.js hepsini günceller (konum, ömür) ve çizer. `FM.fx.*` (core.js) bunları üretir. Halkalar `FM.S.rings [{x,y,r,col,life,max,w}]` de render-fx'te güncellenir/çizilir.

## OLAYLAR (`FM.on(ad, fn)`)
game.js yayınlar (r = yarışçı; çoğu ses/görev için `r === FM.S.player && FM.S.mode !== 'demo'` kontrolü yap):
```
match:start {racers, player, rounds, mode} race:start {round, rounds, theme, mode}       countdown {n: 3,2,1,0}     go {}
jump {r, dbl}   land {r, hard}   slide {r}   slam {r}   slamLand {r}   climb {r}   vault {r}   flap {r}
pad {r}   mush {r}   box {r, item|null}   coin {r,x,y}   item:use {r, item}   ability {r, id}
hit {victim, src, kind, cause}   blocked {r, by:'shield'|'balloon', src, cause}
death {r, src, killer, cause, self}   (cause: eşya anahtarı | 'spikes'|'crush'|'saw'| sıvı adı)
respawn {r}   splash {x,y,liquid,r}   explode {x,y,rad,owner}   trap:snap {e,r}   bolt:strike {r}
finish {r, place, time, survivor?}   (survivor: elemede son kalan, bitişe varmadan kazandı)
race:end {ranking, player, playerRank, round, rounds, theme, trophyDelta, last, mode, n}
portal {r,i,ax,ay,bx,by}   vent {r,i,kind:'lift'|'burst'}   mush {r, kind:'tramp'} (trambolin)   gate {r,n}   eliminated {r,gate}
meteor:shower {n}   meteor:warn {x,y,t}   meteor {x,y}   coins:drop {r,x,y,n,key,ids}   coins:pick {r,id,n}   coins:bonus {r,n}   coin {r,x,y,n?,drop?}   timeup {}
ui:podium (aynı sonuç nesnesi, 1.5 sn sonra; mode='podium')
match:end {standings, player, champion}
ui:menu {}   ui:pause {toggle?, force?}   ui:hide {}   boot {}   resize (FM.view)
```
meta.js yayınlar: `meta:change {}`, `meta:rewards {rewards}`, `meta:levelup {level}`, `meta:mission {mission}`.

## OYUN API (`FM.game`)
`startMatch({char, rounds, mode, theme: 'random'|indeks|id, n})` (n = toplam yarışçı 2..10; verilmeyenler FM.save.mode/map/rivals'tan), `next()` (sonraki tur veya maç sonu → 'match:end'), `startDemo()`, `toMenu()` (demoya dön + 'ui:menu'), `quitRace()`, `ranking()` (moda göre: Altın Avı'nda altına göre, elemede elenenler sonda), `timeLeft()`, `finishNow()` (turu hemen bitir), ağ/test yardımcıları: docs/MULTIPLAYER.md "Uygulama Notları → Motor".
Puan/kupa: `FM.PTS`/`FM.TROPHY` 10 kişilik tablolar; n kişilik yarışta `FM.ptsFor(n)`/`FM.trophyFor(n)` kullan (4 kişide puan 15/8/4/1, kupa 30/12/-5/-15).
Duraklatma: `FM.S.paused = true/false`. Girdi: `FM.input = {jh, jp, dh, dp, use, ab}` — jp/dp/use/ab "basıldı" darbeleri (game tüketir), jh/dh "basılı tutuluyor".
Klavye main.js'de: Boşluk/↑/W zıpla (basılı tut = tırmanma), ↓/S kayma/çakılma, E/Shift eşya, Q/F özel güç, Esc/P duraklat.

## RENDERER API'leri
**render-world.js** → `FM.R.drawBackground(ctx)`, `FM.R.drawWorldBack(ctx)`, `FM.R.drawWorldFront(ctx)`.
**render-chars.js** → `FM.R.drawRacers(ctx)`; `FM.R.drawCharacter(ctx, id, x, y, scale, pose, opts)` (x,y = AYAK noktası; pose `{st:'idle'|'run'|'air'|'slide'|'climb'|'fly'|'cheer'|'sad'|'stun', ph, t, vy, sled}`; opts `{skin, outline=true}`); `FM.R.portrait(id, size, opts)` → önbellekli HTMLCanvasElement (size×size piksel, baş+gövde çerçeveli, dış hatlı; opts.skin, opts.bg).
**render-fx.js** → `FM.R.drawEnts(ctx)`, `FM.R.drawParticles(ctx)`, `FM.R.drawScreenFX(ctx)`; parçacık/halka güncellemesini `FM.R.updaters` ile yapar; iz (trail) parçacıklarını yarışçı hareketine göre kendisi üretir.
**render-hud.js** → `FM.R.drawHUD(ctx)`, `FM.R.drawPodium(ctx)`, `FM.R.itemIcon(key, size)` → önbellekli canvas (emoji DEĞİL, çizilmiş vektör ikon), `FM.R.coinIcon(size)`, `FM.R.gemIcon(size)`.

## META API (`FM.meta`) — meta.js
```
mods(charId) -> {abLv, chargeMul, startItem}       // game.js maç başında çağırır; botlar oyuncunun değerlerini kopyalar (eşitlik)
coins(), gems(), add(cur:'coins'|'gems', n, reason), spend(cur, n) -> bool
levelInfo() -> {level, xp, need, pct}
missions() -> [{id, kind:'daily'|'ach', title, desc, icon, goal, prog, reward:{coins,gems,xp}, done, claimed}]
claim(id) -> reward|null
upgrades(charId) -> [{key, n, desc, icon, lv, max, cost, cur, scope:'char'|'global'}]
buyUpgrade(key, charId) -> bool
owns(type, id, charId), buyCosmetic(type, id, charId) -> bool, equip(type, id, charId), equipped(type, charId)
     type ∈ 'skins'|'trails'|'plates'
lastRewards -> {coins, gems, xp, lines:[{t, v, icon}], levelUp, missionsDone:[...]}  (race:end'de hesaplanır)
daily() -> {ready, streak, reward}, claimDaily() -> reward|null
```
Kayıt `FM.save` (core.js) içinde tutulur; değişince `FM.persist()`.

## SES API (`FM.audio`) — audio.js
`FM.audio.unlock()` (ilk kullanıcı etkileşiminde; kendisi de pointerdown/keydown dinler), `play(name, opts)`, `music(themeId|'menu'|null)`, `setVolume('music'|'sfx', 0..1)`, `click()` (UI tık sesi). Olayları kendisi dinler.

## UI (ui.js + css/style.css)
`#ui` kökünü JS ile doldurur. Olaylar: `ui:menu` → ana menü göster; `race:start` → menüyü gizle, HUD tuval tarafından çizilir; `ui:podium` → sonuç paneli (FM.meta.lastRewards ile); `match:end` → final ekranı; `ui:pause` → duraklatma menüsü; `ui:hide` → her şeyi gizle (dev modu).
Geliştirici modunda `?dev=1&scene=menu&ui=shop` gibi parametrelerle doğrudan bir ekranı açabilmeli (`ui` ∈ menu, chars, shop, missions, clan, settings, help, pause, results, final).

## TEST ARAÇLARI
- `node dev/sim.js 8` → oyun mantığını tarayıcısız simüle eder (core+gfx+level+game+meta).
- `node dev/shot.js "scene=race&t=8&theme=0&char=Kral" C:/yol/cikti.png 1280 720` → headless Chrome ile tek kare ekran görüntüsü + tarayıcı konsol hataları. scene ∈ race | podium | menu; theme 0..3 (orman, şeker, kar, kale); t = simüle edilen saniye; seed sabit harita için. Ekran görüntüsünü Read aracıyla açıp GÖZLE kontrol et. Telefon oranı için `2400 1080` ya da `844 390` dene.
- Ekran görüntülerini kendi scratchpad klasörüne kaydet, proje klasörüne değil.
- Sözdizimi: `node --check js/dosya.js`.
