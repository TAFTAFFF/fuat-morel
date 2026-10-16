# FUAT MOREL — 5. Tur: Yönlü Atış, Belirginlik, Kamera, Oynanış Hissi, Otomatik Başlama, Kalıcı Lobi, Çevrimiçi Listesi, Profil Kartları

Bu belge `docs/CONTRACT.md` ve `docs/MULTIPLAYER.md`'yi GENİŞLETİR; önce onları oku (MULTIPLAYER.md uzun: kendi alanının "Uygulama Notları" bölümünü mutlaka oku). Bu turda ajanlar AYNI ANDA çalışıyor; bu belgedeki arayüzler (isimler, alanlar, olaylar) SÖZLEŞMEDİR: aynen uygula, adını değiştirme. Başka bir ajanın henüz yazmadığı bir fonksiyonu çağırırken `typeof … === 'function'` ile koru.

## 0. Kullanıcının istekleri (özet, kendi sözleriyle)
- "Güçle eşya yeterince belirgin değil oyunda. Bence oyundaki her şey."
- "Güçle eşyayı normalde Fun Run'da yön tuşlarıyla da atabiliyorsun, bazı skillerde yön tuşlarıyla atman gerekiyor."
- "Haritalar ekranın yarısında başlıyor, aşağıda başlayabilir. Ekranı daha iyi paylaştırabilirsin, haritayı üstte hissediyorum."
- "Genele baktığında Fun Run'dan daha gelişmiş. Şimdi oynanışı iyileştirme kaldı."
- Lobi: "herkes hazır olunca başlasın", "lobi unutulmasın" (turlar arası otomatik devam, maç sonu herkes lobiye döner, sayfa yenilenirse odaya geri dön).
- Çevrimiçi listesi: kim çevrimiçi, ne yapıyor, KATIL.
- YENİ: "Hepimizin kupa sayısı 0 olsun. Herkes birbirinin kaç saat oynadığını, çevrimiçi olup olmadığını falan görsün."
- YENİ: "Anlık o an çevrimiçi olup olmadığını bilmesi de önemli. Çevrimiçiyse bildirim gelsin hatta. Çünkü Kral şu an çevrimiçi değil, mesela çevrimiçi gözüküyor." (Sebep: ui.js `renderClan` bugün çevrimiçi durumunu ve "x sa önce"yi `hashStr` ile UYDURUYOR. Bu tamamen kaldırılacak; yalnızca gerçek varlık verisi gösterilecek.)
- Genel hedef: "2026 çağının oyunu olsun." Oynanış, arayüz/kullanıcı deneyimi (UI/UX), eklenmesi, geliştirilmesi ve dikkat edilmesi gereken her şey. Çok kaliteli olsun.

Asıl platform yine YATAY TELEFON (dokunmatik). Tüm metinler Türkçe (ç ğ ı İ ö ş ü). Konsolda tek hata olmamalı. Orta seviye telefonda 60 FPS.

## 1. Ajanlar ve dosya sahipliği (bu tur)
| Ajan | Dosyalar |
|---|---|
| MOTOR (Opus) | js/game.js, js/main.js, js/level.js, js/core.js (kayıt bölümü HARİÇ: `FM.defaultSave`/`FM.normSave`), dev/sim.js, dev/deathloop.js |
| AĞ (Opus) | js/net.js, js/netgame.js, dev/net-*.js, dev/mp-*.js (mp-ui.js hariç), yerel test aracısı (dev/broker.js) |
| DÜNYA+KARAKTER (Fable) | js/render-world.js, js/render-chars.js |
| EFEKT+HUD (Fable) | js/render-fx.js, js/render-hud.js |
| ARAYÜZ+SES (Sonnet) | js/ui.js, css/style.css, js/audio.js, sw.js (bildirim tıklama; önbellek sürümünü ana ajan artırır), dev/mp-ui.js, index.html (yalnızca gerekirse) |
| PROFİL (Sonnet) | js/meta.js, js/core.js içindeki `FM.defaultSave` + `FM.normSave` (kayıt şeması) |

Kural: yalnızca kendi dosyalarını değiştir. Başka dosyada değişiklik gerekiyorsa son raporuna `İSTEKLER:` başlığıyla yaz; ana ajan entegre eder. core.js iki ajanda paylaşılıyor: MOTOR kayıt bölümüne, PROFİL de geri kalanına dokunmaz. Düzenleme aracı "dosya değişti" derse dosyayı yeniden oku, sonra tekrar dene. Git commit ve push YAPMA, bunları ana ajan yapar.

## 2. YÖNLÜ ATIŞ (Fun Run'daki gibi)
### 2.1 Girdi: `FM.input` (game.js tanımlar)
```
FM.input = { jh, jp, dh, dp, use, ab,          // mevcut
             aim: null | 'item' | 'ab',          // YENİ: şu an nişan alınıyor mu (düğme/tuş basılı)
             ax: 0, ay: 0 }                      // YENİ: nişan birim vektörü (x sağa +, y aşağı +); (0,0) = varsayılan yön
```
- Nişan sırasında (parmak EŞYA/GÜÇ düğmesinde basılı ya da E/Q basılı): `aim = 'item'|'ab'`, `ax, ay` = anlık yön. Ölü bölgede (parmak ~18 CSS px'ten az hareket ettiyse) `ax = ay = 0`, yani varsayılan yön.
- Bırakınca: `use = true` (ya da `ab = true`), `aim = null`; `ax, ay` son yönü TUTAR. game.js darbeyi tüketirken `ax, ay`'yi okur ve sonra sıfırlar.
- Kısa dokunuş (sürükleme yok) → (0,0) → varsayılan yön (bugünkü davranış). Yönsüz eşyalar (hız, kalkan, balon, yıldırım, buz, mürekkep, mıknatıs) ve yönsüz güçler (LUL, ertan) nişan beklemeden DOKUNUNCA hemen çalışabilir. ARAYÜZ bunu `FM.game.aimable(kind)` ile sorar (aşağıda): false ise nişan çizgisi gösterme, basınca (pointerdown) hemen kullan.
- Dokunmatik (ARAYÜZ): EŞYA/GÜÇ düğmesine bas → sürükle → nişan → bırak. Yön = düğmeye basılan noktadan parmağa doğru vektör. Sürüklerken parmak düğmeden çıkabilir (pointer capture). İki parmak: ZIPLA basılıyken diğer parmakla nişan alınabilmeli (çoklu dokunuş).
- Klavye (MOTOR, main.js): E/Shift/J basılı → `aim='item'`; Q/F/K basılı → `aim='ab'`. Basılıyken ok tuşları/WASD yön verir (çapraz için iki tuş birlikte), ZIPLA/KAY YAPMAZ. Bırakınca ateş. Yön tuşu basılmadıysa varsayılan yön. Yönsüz eşyalarda basınca hemen kullan.
- Nişan sırasında oyun yavaşlamaz (çok oyunculu adalet).

### 2.2 Motor (game.js)
- `useItem(r, ax, ay)` ve `useAbility(r, ax, ay)`: `p` nesnesine `ax, ay` (2 ondalık) eklenir. `castItem(r, it, p)` ve `castAbility(r, p)` yönü `p.ax/p.ay`'den alır; ikisi de yoksa ya da (0,0) ise bugünkü varsayılan davranış. Ağdan gelen eski mesajlarla geriye uyumlu.
- Yönlü olanlar (ayrıntı ve denge MOTOR'da):
  - testere: nişan yönünde fırlatılır (ileri/geri; yukarı çapraz kavisli atış), duvardan seker
  - dinamit: nişan yönünde fırlatma hızı → yörünge
  - tuzak: varsayılan ayağının dibine/arkasına; yön verilirse o yöne kısa atış (yere düşünce kurulur)
  - ağ: varsayılan arkaya; yön verilirse o yöne kısa atış
  - füze: varsayılan öndeki lider; geri çekilirse (ax < -0.3) arkandaki en yakın rakip
  - TAFTAF Gölge Atılımı: nişan yönüne atılım (yukarı çapraz dahil, kısa ve güvenli)
  - Caner Kızıl Ay Kargaları: hedef nişan yönündeki en yakın rakip (önde/arkada)
  - Kral Kükremesi: koni nişan yönüne (ileri/geri)
  - baso Bas Dalgası: dalga nişan yönünde ilerler (ileri/geri)
  - Nuss Tüy Süzülüşü: süzülüş yönü (ileri-yukarı / ileri)
  - Yönsüz: hız, kalkan, balon, yıldırım, buz, mürekkep, mıknatıs, LUL Goril Yumruğu, ertan Buz Kızağı
- `FM.game.aimable(kind)` → bool: yerel oyuncunun elindeki eşya (kind='item') ya da gücü (kind='ab') yönlü mü.
- `FM.game.aimPreview(r, kind, ax, ay)` → gerçek fizikle (aynı sabitler) hesaplanan önizleme:
  `{ kind, key, shape: 'arc'|'line'|'cone'|'target'|'none', pts: [[x,y],…] (dünya koordinatı; arc/line için ~16-28 nokta, çarpınca kesilir), cone: {x, y, ang, spread, len} | null, tgt: racer | null, ok: bool }`. `key` = eşya anahtarı ya da karakter id. `ok=false` ise şu an kullanılamaz (başlangıç kilidi, hedef yok…).
- Her karede yerel oyuncu nişan alıyorsa `FM.S.aim = aimPreview(...)`, almıyorsa `FM.S.aim = null`.
- Botlar yönü kullanır (arkadakine testere, hedefe dinamit yayı, öndekine koni…). Ağda: botların ve herkesin atışı `p.ax/p.ay` ile gider.
- Yeni olay: `charge:full {r}`: özel güç %100'e ulaştığı an (yerel oyuncu için ses/titreşim). `aim:start {kind}` / `aim:end {kind, fired}`: yerel oyuncu nişana başladı/bitti (ses için).

### 2.3 Ağ (netgame.js)
`'it'` ve `'ab'` mesajlarına `ax, ay` alanları eklenir (2 ondalık, yoksa gönderme); alan tarafında `p.ax/p.ay` olarak castItem/castAbility'ye geçer. Diğer yeni sayısal p alanları (MOTOR eklerse, ör. tuzağın atış hızı `vx/vy` zaten var) aynı şekilde geçmeli. MOTOR yeni p alanı eklerse bunu son raporunda listeler.

### 2.4 Çizim
- `FM.R.drawAim(ctx)` (EFEKT): dünya koordinatında, `FM.S.aim`'i çizer: yay için kesikli parlayan yörünge + iniş noktası halkası, çizgi için ok, koni için yarı saydam koni, hedef için nişangâh. `ok=false` ise kırmızı/soluk. main.js (MOTOR) bunu `drawWorldFront`'tan SONRA, dünya dönüşümündeyken çağırır (`typeof FM.R.drawAim === 'function'` koruması).
- Uzak oyuncuların atışları herkesin ekranında aynı yönde görünür (varlıklar aynı p ile kurulur).

## 3. BELİRGİNLİK ("eşya ve güç belirgin değil, bence oyundaki her şey")
- ARAYÜZ: EŞYA ve GÜÇ dokunmatik düğmeleri büyür (en az ~84 CSS px, kısa ekranda orantılı), kontrast artar, elde eşya varken ikon büyük ve net (`FM.R.itemIcon`), boşken bile düğme okunur. Güç dolunca düğme "HAZIR!" diye parlar/nabız atar. Nişan sırasında düğmede yön oku.
- `FM.haptic(kind)` (ARAYÜZ tanımlar, ui.js): `navigator.vibrate` ile kısa titreşim; ayarlardan kapatılabilir (`FM.save.settings.haptic`, varsayılan true). kind ∈ 'pick' | 'ready' | 'hit' | 'death' | 'tap' | 'win' | 'count' | 'aim'. Diğerleri `typeof FM.haptic === 'function' && FM.haptic('pick')` diye çağırır. ARAYÜZ ayrıca box/charge:full/death/finish olaylarını kendisi dinleyip titreştirebilir. Çift titreşim olmasın: titreşimi YALNIZCA ARAYÜZ tetikler (diğerleri çağırmasın; olaylar yeterli).
- Eşya alınca (EFEKT+HUD, render-hud.js): `box {r, item}` olayında yerel oyuncu için karakterin başının üstünde büyük eşya ikonu "pop" eder, sonra eşya yuvasına uçar. Hedef: `FM.ui.slotRect('item'|'ab')` → `{x, y, w, h}` MANTIKSAL ekran birimi (FM.view.VW × FM.view.VH ölçeğinde) ya da null. Varsa oraya, yoksa HUD'un kendi eşya yuvasına uçar. Varınca `FM.emit('hud:arrive', {kind: 'item'})` (ARAYÜZ düğmeyi zıplatır).
- Güç dolunca: yerel oyuncunun etrafında parlak nabız halkası (render-fx ya da render-chars; EFEKT yapar), masaüstü HUD'daki GÜÇ yuvası "HAZIR!" parlar (render-hud).
- DÜNYA: kutular, altınlar ve tehlikeler (diken, testere, ezici, kaya, meteor…) daha kalın hatlı, daha parlak ve uzaktan okunur. Kutuların etrafında hafif nabız/ışıltı. Arka plan katmanları biraz solar ve kontrastı düşer (atmosferik pus): oyun alanı öne çıkar. Pahalı şeyler önbellekli sprite olarak çizilir.
- KARAKTER: yerel oyuncu açıkça ayırt edilir (hafif kenar ışığı / ayak halkası). Rakipler okunur kalır. Karakterler kameranın yakınlaşmasıyla biraz büyük görünür (ölçek MOTOR'un kamerasından gelir; çizim boyutlarını elle büyütme).

## 4. KAMERA (MOTOR, main.js)
- Telefonda zemin ekranın üstten yaklaşık %70-72'sine iner (bugün ~%60). Karakterler ve nesneler biraz büyür (telefonda `FM.view.VH` 440 → ~400 civarı; kendin dene, okunaklılık ile ileriyi görme dengesi).
- Üst HUD bandı ile isim plakaları çakışmamalı. Köşelerdeki düğmeler ortadaki yolu kapatmamalı.
- Masaüstünde de benzer iyileştirme (zemin ~%68-70).
- Renderer'lar her zaman `FM.view.VH/VW` kullanır; sabit değer yok.

## 5. OYNANIŞ HİSSİ (MOTOR)
- Zıplama tamponu: yere değmeden ~0.12 sn önce basılan zıplama sayılır. Kenardan düşerken kısa "coyote" süresi (yoksa ekle).
- Dikenler ve tehlikeler birkaç piksel daha affedici (çarpışma kutusu küçülür).
- Isınma: yarışın ilk birkaç saniyesi (koşu mesafesiyle ~3 sn) tehlikesiz düz başlangıç.
- 2026 hissi: vuruşta çok kısa "hit-stop" (yalnızca yerel görsel, simülasyonu ağda bozmadan), daha iyi ivme eğrileri, iniş/zıplama tepkileri. Ağ eşitliğini ve deterministik akışı bozma.

## 6. HERKES HAZIR OLUNCA OTOMATİK BAŞLAMA (AĞ + ARAYÜZ)
- Lobide ev sahibi DAHİL herkes HAZIRIM'a basar (`FM.net.setReady(bool)` zaten var; ev sahibinin hazır bayrağı da lobide görünür).
- Odadaki tüm (bağlı) insanlar hazırsa → ev sahibi 5 sn geri sayım başlatır ve tüm üyelere yayınlar. Geri sayım biterse yarış kendiliğinden başlar (`hostStart`).
- Biri hazırı geri alırsa, yeni biri girerse ya da biri çıkarsa geri sayım iptal olur.
- Olay: `mp:countdown {left: 5|4|3|2|1|null, reason?: 'unready'|'join'|'leave'|'start'}` her saniye tüm istemcilerde; `null` = yok/iptal. `FM.netgame.countdown()` → kalan sn ya da null.
- Ev sahibinde "HEMEN BAŞLAT" düğmesi kalır (tek başına botlarla oynamak ya da beklemeden başlatmak için): `FM.netgame.hostStart()`.
- Tek insan (yalnız ev sahibi) varken HAZIRIM da geri sayımı başlatır.

## 7. LOBİ UNUTULMASIN (AĞ + ARAYÜZ)
- Turlar arası: kürsüden sonra birkaç saniye (~6 sn) içinde sonraki tur kendiliğinden başlar. Kalan süre `FM.netgame.autoLeft()` (her istemcide doğru göstermeli; üyeler için de).
- Maç sonu: final ekranından ~10 sn sonra (ya da ev sahibi düğmeye basınca) herkes otomatik olarak LOBİYE döner, menüye atılmaz. Oda, ayarlar ve oyuncular korunur, sadece hazırlar sıfırlanır. Tekrar herkes HAZIRIM deyince yeni maç başlar.
- Yeniden bağlanma: odaya katılınca `localStorage`'a `{code, broker, t, pid}` yazılır (pid kalıcı olsun ki ev sahibi aynı oyuncu olarak tanısın). Sayfa yenilenirse ya da telefon uygulamayı kapatıp açarsa, son 15 dakika içinde girdiğin odaya otomatik geri dönülür (link ile ?oda= gelinmişse o öncelikli). "ODADAN AYRIL" ile bilerek çıkınca kayıt silinir.
- API: `FM.netgame.rejoinInfo()` → `{code, mins, nick}` | null; `FM.netgame.rejoin()` → bool; `FM.netgame.forgetRoom()`.
- Olay: `mp:rejoining {code}` (otomatik dönüş başladı; ARAYÜZ "Odaya geri dönülüyor…" gösterir), başarısızsa `mp:left {reason: 'rejoin-failed'}`.
- Menüde, `rejoinInfo()` doluysa ve odada değilsen "ODAYA GERİ DÖN" düğmesi (ARAYÜZ).

## 8. ÇEVRİMİÇİ LİSTESİ + PROFİL KARTLARI (AĞ + PROFİL + ARAYÜZ)
### 8.1 Profil kartı (PROFİL, meta.js)
- `FM.meta.card()` → `{nick, char, skin, lvl, tr, play, races, wins, kills, best, since}`: tr = toplam kupa (tüm karakterler), play = toplam oynama süresi sn, races/wins = toplam yarış/birincilik, best = en çok oynanan karakter, since = ilk oynama zamanı (ms).
- Oynama süresi: sayfa görünürken ve son 90 sn içinde kullanıcı etkileşimi (dokunma/tuş) varken ya da yarış sürerken geçen süre `FM.save.stats.playSec`'e birikir (saniyede bir artırma yerine birkaç saniyede bir toplu yaz; `FM.persist` çağrısını seyrek yap). `FM.meta.playTime()` → sn.
- Kupa sıfırlama: herkesin kupası 0'dan başlar. `FM.defaultSave` kupaları 0 başlatır. `FM.normSave` bir kerelik göç yapar: kayıtta `trReset !== 1` ise tüm karakter kupalarını 0 yapar ve `trReset = 1` yazar (içe aktarılan eski kayıtlar da sıfırlanır). Kupa 0'ın altına inmez (kaybedince 0'da kalır).
- Olay: `meta:card {}`: kart değişti (kupa, seviye, karakter vb.). AĞ bunu dinler.

### 8.2 Varlık (presence) yayını (AĞ, net.js)
- Oyun açıkken (oda dışında da) hafif bir varlık bağlantısı: tercih edilen aracıya bağlan (oda bağlantısı aynı aracıdaysa onu paylaş).
- Konular: `fuatmorel/v1/_on/<pid>` (canlı nabız, retain YOK, ~5 sn'de bir ve durum değişince) ve `fuatmorel/v1/_pr/<pid>` (profil kartı, RETAIN, değişince ve dakikada bir; `ls` = son görülme ms). Sayfa kapanırken (`pagehide`) `_on`'a `{st:'off'}` gönder ki liste hemen düşsün; ~12 sn nabız gelmeyen listeden düşer.
- Nabız içeriği: `{pid, nick, char, st: 'menu'|'lobby'|'race'|'solo', code?: (yalnızca açık lobide), n?, max?, open?: bool, v}`. Durum otomatik çıkarılır (odada lobide → 'lobby'; odada yarışta → 'race'; tek oyunculu yarışta → 'solo'; diğer → 'menu').
- API: `FM.net.online()` → `[{pid, nick, char, st, code, n, max, open, me, age}]` (kendin dahil, me=true), `FM.net.profiles()` → `[{pid, nick, char, skin, lvl, tr, play, races, wins, kills, best, since, ls, online: bool, st}]` (bilinen tüm oyuncular; çevrimiçi olanlar önce). Olaylar: `net:online {list, n}` ve `net:profiles {list}` (değişince, seyreltilmiş).
- Yalnızca takma ad, karakter, durum, oda kodu (sadece açık lobide) ve profil kartı paylaşılır. Başka kişisel bilgi yok.
- Varlık bağlantısı oyunu yavaşlatmamalı, pil yememeli: yarış sırasında nabız 10 sn'ye çıkabilir; sekme gizliyken nabız durur.

### 8.3 Doğruluk: "çevrimiçi" gerçekten çevrimiçi demek
- Oyunda HİÇBİR yerde uydurma/rastgele sosyal veri (çevrimiçi durumu, "x sa önce", kupa, oynama süresi) kalmaz. Veri yoksa "bilinmiyor"/boş gösterilir.
- Çevrimiçi = son ~12 sn içinde nabız geldi. Sayfa kapanınca (`pagehide`) anında düşer. Sekme/uygulama arka plandaysa nabız seyrekleşebilir (tarayıcı zamanlayıcıları kısar); arka planda 60 sn'yi geçen kişi "Uzakta" (st: 'away') olarak gösterilebilir, ama asla "çevrimiçi" diye yalan söylenmez.

### 8.4 Bildirim: arkadaşın çevrimiçi oldu (AĞ olayı + ARAYÜZ)
- AĞ: bir oyuncu çevrimdışından çevrimiçine geçince `net:came {p}` (ilk liste yüklemesinde değil; aynı kişi için 10 dk'da en fazla 1 kez), açık lobi kurunca `net:lobby-open {p}` olayı.
- ARAYÜZ: oyun açıkken şık bir uygulama içi bildirim (portre + "Kral çevrimiçi oldu!" + açık lobi varsa KATIL), kısa ses ve titreşim.
- Sekme/uygulama arka plandayken (`document.hidden`) ve kullanıcı izin verdiyse: `navigator.serviceWorker.ready` → `registration.showNotification('Fuat Morel', {body: 'Kral çevrimiçi oldu!', icon, tag})`; sw.js `notificationclick` ile oyunu öne getirir (ve lobi varsa `?oda=KOD` ile açar).
- Ayarlar: "Bildirimler" anahtarı (`FM.save.settings.notify`, varsayılan false); açınca `Notification.requestPermission()` (kullanıcı hareketiyle). İzin reddedilirse anahtar kapalı kalır ve nedenini söyler.
- Sınır (dürüst ol): oyun tamamen KAPALIYKEN bildirim gelmez (bunun için bir push sunucusu gerekir; GitHub Pages + herkese açık MQTT ile mümkün değil). Ayarlarda kısa bir notla belirt: "Bildirimler oyun açıkken ya da arka plandayken gelir."

### 8.5 Arayüz (ARAYÜZ, ui.js)
- Menü: "ÇEVRİMİÇİ (3)" gibi yeşil noktalı düğme. Açınca herkes: takma ad, karakter portresi, durum ("Menüde", "Lobide · 3/10", "Yarışta", "Tek başına oynuyor"), oynama süresi, kupa. Açık lobisi olanın yanında KATIL (tek dokunuşla `FM.net.joinRoom(code)` akışı).
- Klan ekranı: tüm bilinen oyuncular (profil kartları): çevrimiçi olanlar yeşil noktalı ve en üstte; diğerleri "son görülme: 2 saat önce". Her kartta oynama süresi ("12 sa 30 dk"), kupa, seviye, yarış/birincilik.
- Lobi: çevrimiçi arkadaşların listesi + davet linki paylaşma (`navigator.share` varsa onunla, yoksa kopyala).

## 9. 2026 KALİTESİ: her ajan kendi alanında
Her ajan yukarıdakilere EK OLARAK kendi alanında en etkili birkaç iyileştirmeyi seçip uygular. Az ama kusursuz olsun; performansı ve diğer ajanların sözleşmesini bozmasın. Son raporunda ne eklediğini listele. Örnek fikirler:
- MOTOR: nişan yardımı (dokunmatikte yönü en yakın hedefe hafifçe çek, ayardan kapatılabilir `FM.save.settings.aimAssist`), arkadan gelenlere karşı adil eşya dağılımı (geride olana daha iyi eşya), ölüm sonrası hızlı ve adil yeniden doğma, hit-stop.
- AĞ: bağlantı kalitesi, hızlı yeniden bağlanma, lobi durumu tutarlılığı.
- DÜNYA+KARAKTER: okunaklılık, tehlike uyarıları (testere/ezici öncesi ipucu), derinlik, karakter ifadeleri.
- EFEKT+HUD: ekran dışındaki rakipler için kenar okları (portreli), vurulma yönü göstergesi, daha net geri sayım ve bitiş, sonraki tur sayacı (`FM.netgame.autoLeft()`).
- ARAYÜZ+SES: güvenli alan (çentik) payları, büyük dokunma hedefleri, ayarlar: Titreşim, Ekran sarsıntısı (mevcut `shake`), Nişan yardımı, Düğme boyutu (`FM.save.settings.btnSize` 'S'|'M'|'L'), Solak düzen (`FM.save.settings.lefty`: düğme tarafları yer değiştirir); ilk yönlü atışta kısa ipucu ("Basılı tut, sürükle, bırak!"); nişan/hazır/geri sayım sesleri.
- PROFİL: profil kartı istatistikleri, kupa sıfırlama göçü, yeni başarımlar (oynama süresi), kayıt kodu uyumu.

## 10. Test
- `node --check js/<dosya>.js` (sözdizimi), `node dev/sim.js 8` (mantık), `node dev/shot.js "scene=race&t=8&mobile=1&touch=1&ui=touch" <scratchpad>/x.png 844 390` (telefon karesi; Playwright ile tam görüntü alanı). Ekran görüntüsünü Read ile açıp GÖZLE kontrol et; çıktıları kendi scratchpad klasörüne kaydet, projeye değil.
- Bu bulut ortamından herkese açık MQTT aracılarına BAĞLANILAMIYOR. Çok oyunculu test için yerel aracı: AĞ ajanı `dev/broker.js` yazar (MQTT 3.1.1 over WebSocket, `ws://127.0.0.1:<port>/mqtt`, retain ve will destekli, bağımlılıksız ya da npm ile scratchpad'e kurulan paketle) ve `?brokerUrl=ws://127.0.0.1:<port>/mqtt` geliştirici parametresiyle net.js tüm aracıları bununla değiştirir (yalnızca `dev=1` ya da açıkça parametre verildiğinde).

## 11. Ana ajanın ek fikirleri (sonradan eklendi; kullanıcı: "senin de fikirlerin olabilir, onları da ekle")
- MOTOR: **Rüzgâr arkası (draft)**: bir rakibin hemen arkasında (~40-160 px, aynı yükseklikte) ~0.6 sn koşan yarışçı hafif hız kazanır (`r.draft` 0..1); yarışlar daha çekişmeli olur. **Kusursuz iniş**: yere çakılma (slam) zemine değmeden hemen önce bırakılırsa ya da tam zamanında zıplanırsa küçük bir hız ödülü (`perfect {r}` olayı). **Kıl payı**: yerel oyuncu bir testere/ezici/dikene/füzeye birkaç piksel farkla değmeden geçerse `nearmiss {r, cause}` olayı (sık tetiklenmesin; 2 sn'de en fazla 1).
- EFEKT+HUD: `r.draft > 0` iken karakterin önünde ince rüzgâr çizgileri; `perfect` olayında küçük "KUSURSUZ!" yazısı + parıltı; `nearmiss` olayında "KIL PAYI!" yazısı (yalnız yerel oyuncu).
- PROFİL: **Lig** kupa sayısına göre: Bronz (0+), Gümüş (300+), Altın (800+), Elmas (1600+), Efsane (3000+) → `FM.meta.league(tr)` → `{id, n, col, min, next}`; karta `lg` (lig id) eklenir. **Kafa kafaya**: çok oyunculu yarış sonuçlarından (`race:end` sonucunda `mp: true` iken sıralama, pid/nick) arkadaşlara karşı kim kimi geçti sayacı: `FM.meta.h2h()` → `{pid: {nick, w, l}}` (en fazla ~50 kişi, kayıtta küçük).
- ARAYÜZ: kartlarda lig rozeti; klan ekranında bir oyuncuya dokununca profil ayrıntısı (oynama süresi, kupa, lig, yarış/birincilik, en çok oynadığı karakter, "Sana karşı: 12-8"); maç sonu (final) ekranında eğlenceli ödüller: "En çok avlayan" (kills), "Altın avcısı" (coins), "Ölümsüz" (en az ölüm), "Roket" (en hızlı tur) — final sıralamasındaki/racer verilerinden.
- SES: `perfect` ve `nearmiss` için kısa ses.
