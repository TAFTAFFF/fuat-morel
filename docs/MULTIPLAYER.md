# FUAT MOREL — Çok Oyunculu Odalar, Modlar, Yeni Haritalar, Kalıcı Kayıt (tasarım)

Kullanıcının isteği (aynen): "Arkadaşlarla oda kurma, aynı anda 10 kişiye kadar beraber oynama. Herkes kendi telefonundan ama aynı oyunda. Ben arkadaşıma link atacağım, o kendi telefonundan, ben kendi telefonumdan. Farklı haritalar, farklı özellikler, farklı modlar. Girdiğimizde kendi gelişmelerimiz silinmemeli, otomatik olmalı."

Bu belge `docs/CONTRACT.md`'yi GENİŞLETİR (onu da oku). Asıl platform yine yatay telefon.

## 1. Ağ: sunucusuz, hesapsız — herkese açık MQTT aracıları (WebSocket)
GitHub Pages yalnızca statik dosya sunar. Oyuncuları birbirine bağlamak için herkese açık, ücretsiz MQTT aracıları (broker) kullanılır; WebRTC değil, çünkü mobil operatör NAT'larında WebRTC sık başarısız olur, MQTT ise düz WSS bağlantısıdır.
Test edildi (2026-10-16, bu bilgisayardan): 
- `wss://broker.emqx.io:8084/mqtt` — bağlantı ~1.2 sn, gidiş-dönüş ~150 ms
- `wss://test.mosquitto.org:8081/mqtt` — ~0.8 sn, ~80 ms
- `wss://broker.hivemq.com:8884/mqtt` — ~2.7 sn, ~350 ms
- (public.mqtthq.com çalışmadı)
Sıra: emqx → mosquitto → hivemq; bağlantı kopar/açılmazsa sıradakine geç. **Odadaki herkes aynı aracıda olmalı**: oda kodu aracı indeksini de taşır (ör. kodun son karakteri) ya da lobi mesajı hangi aracıda olduğunu yayınlar; katılan önce koddaki aracıyı dener.

`js/net.js`: Harici kütüphane YOK — kendi minimal MQTT 3.1.1 istemcimiz (WebSocket alt protokolü `mqtt`, ikili çerçeveler): CONNECT (clean session, keepalive 20 sn, Last Will), CONNACK, SUBSCRIBE/SUBACK, UNSUBSCRIBE, PUBLISH QoS 0 (+ retain bayrağı), PINGREQ/PINGRESP, DISCONNECT; kısmi çerçeve birleştirme; otomatik yeniden bağlanma (üstel bekleme); aracı yedeklemesi. dev/ altında node ile gerçek aracıya karşı test edilebilir (Node 24'te global WebSocket var).

### Konular (topic): `fuatmorel/v1/<ODA>/...`
| Konu | Kim yayınlar | İçerik |
|---|---|---|
| `lobby` (retain) | ev sahibi | oda durumu: oyuncular, mod, harita, tur, durum (lobby/race/results), ev sahibi pid, sürüm |
| `join` | katılan | `{pid, nick, char, skin, trail, plate, ver}` (ev sahibi kabul eder ve lobby'yi günceller) |
| `bye/<pid>` | Last Will / çıkan | ayrılma |
| `ctl` | ev sahibi | `start {seed, theme, mode, round, rounds, roster, botIds}`, `end {ranking}`, `next`, `toLobby`, `kick` |
| `s/<pid>` | her oyuncu (+ ev sahibi botlar için) | durum anlık görüntüsü ~10 Hz |
| `ev` | herkes | olaylar: eşya kullanımı, güç, ölüm, bitiş, kapı geçişi (eleme), emoji |
| `ping` | herkes | 2 sn'de bir canlılık (pid, rtt ölçümü için zaman damgası) |
Mesajlar kısa anahtarlı JSON (bant genişliği küçük). Oda kodu: 5 karakter, karışmayan harfler (A-Z, 2-9; O/0/I/1 yok).

### Yetki modeli ("herkes kendinden sorumlu")
- Her telefon KENDİ yarışçısını simüle eder (fizik, çarpışma, ölüm) ve durumunu yayınlar. Diğer oyuncular ekranda **uzak yarışçı (remote)** olarak, ~120 ms tamponlu ara değerlemeyle (interpolation) çizilir.
- Botlar yalnızca ev sahibinde simüle edilir; ev sahibi onların durumunu da yayınlar (diğerleri için onlar da remote).
- Eşya/güç kullanımı `ev` ile yayınlanır; her istemci aynı varlığı (testere, dinamit, füze...) kendi dünyasında oluşturur. **Hasar yalnızca istemcinin kendi yetkisindeki yarışçılara uygulanır** (kendi oyuncusu; ev sahibinde botlar). Uzak yarışçıya isabet yerelde uygulanmaz; kurban kendi telefonunda vurulduysa ölümünü `ev` ile yayınlar (öldüren pid ile) → herkes akışta görür, öldürenin istemcisi `kills` sayar.
- Alan etkili güçler (LUL yumruğu, Kral kükremesi, buz fırtınası, mıknatıs, mürekkep, yıldırım) kullanıcının konumu/hedefleriyle yayınlanır; her istemci kendi yetkisindeki yarışçılara uygular.
- Bitiş: her istemci bitiş süresini yayınlar; nihai sıralamayı ev sahibi belirler ve `ctl end` ile yayınlar.
- Ev sahibi düşerse: en küçük pid'li bağlı oyuncu ev sahibi olur (lobby'yi devralır). Yarış ortasındaysa yarış devam eder.
- Sürüm uyuşmazlığında "Sayfayı yenile" uyarısı.
- Çok oyunculuda duraklatma YOK (menü açılır ama yarış sürer).

## 2. game.js entegrasyonu (motor ajanı)
- Yarışçı alanları: `ctrl: 'local'|'bot'|'remote'`, `pid`, `nick` (görünen ad; yoksa karakter adı). `bot` boolean'ı geriye uyum için kalır (`ctrl==='bot'`).
- `remote` yarışçı: fizik yok; `FM.net` tamponundan konum/hız/durum bayrakları ara değerlenir; renderer'ların okuduğu alanlar (slide, h, climb, fly, dash, sled, shield, balloon, boost, padT, frozen, stun, netted, dead, finished, item, charge, ph, land, jumpT, skin, trail, plate) doldurulur. Kutu/altın toplamaz, tehlike çarpışması yok.
- Yarış başlatma: `FM.game.startNetRace({seed, theme, mode, roster, round, rounds})` — aynı seed ile aynı harita (genLevel deterministik, tema açıkça verilir).
- Sıralama: bitirenler sırayla, sonra x'e göre (uzaklar ara değerlenmiş x).
- 10 yarışçıya kadar: puan tablosu `FM.PTS` 10 kişiye genişletilir (ör. 15,12,10,8,6,5,4,3,2,1); kupa değişimi sıraya göre.
- Kutu bekleme dizisi `cd` uzunluğu 10. Altın bit maskesi 10 bit (sorun yok).

## 3. Modlar (`S.gameMode`) — tek oyunculu ve çok oyunculu ikisinde de
| id | Ad | Kural |
|---|---|---|
| `classic` | Klasik Yarış | Bitişe ilk varan kazanır (mevcut). |
| `elim` | Eleme | Haritada 3-4 eleme kapısı (L.gates). Hayattaki herkes bir kapıdan geçince en son geçen elenir (izleyici olur). Son kalan ya da bitişe ilk varan kazanır. |
| `coins` | Altın Avı | 75 sn süre. Çok daha fazla altın (kümeler, yüksek yollar). Sıralama toplanan altına göre; bitişe varan +15 altın bonus alır ve yarış onun için biter. Ölünce topladığının %20'sini düşürür (yerde parlayan altın). |
| `pure` | Saf Parkur | Eşya kutusu yok, özel güç var. Daha teknik harita (daha çok duvar, platform, ezici). |
| `chaos` | Kaos | Kutular 1.5 sn'de yenilenir, güç 2 kat hızlı dolar, saldırı eşyaları daha sık; ara ara gökten meteor yağar (uyarı gölgesiyle). |

## 4. Yeni haritalar (temalar) — her biri kendi mekaniğiyle
Mevcut: forest (orman), candy (şeker), snow (kar — **yeni mekanik: buzlu zemin parçaları, kaygan**), castle (kale/lav).
Yeni:
| id | Ad | Sıvı | Mekanik |
|---|---|---|---|
| `desert` | Çöl Tapınağı | `quicksand` (bataklık kum) | kum çukurları (yavaşlatan çamur yerine), tapınak sütunları, yuvarlanan kaya (ezici yerine yuvarlanan taş) |
| `space` | Uzay İstasyonu | `plasma` | düşük yerçekimi bölgeleri (mor alan; yerçekimi ×0.55), ışınlanma kapıları (portal çifti: A'ya giren B'den çıkar), neon platformlar |
| `city` | Gece Şehri | `neon` (zehirli yeşil su) | çatılar arası trambolinler, vinçler, neon tabelalar, rüzgâr bacası (yukarı iten hava akımı) |
| `tropic` | Tropik Ada | `water` (deniz) | gayzerler/buhar çıkışı (yukarı iten), palmiye, dalgalı deniz, sallanan köprüler |
Yeni seviye öğeleri: `vents [{x,y,w,h}]` (yukarı iten akım), `portals [{ax,ay,bx,by}]`, `lowg [{x,w}]`, `ice [{x,y,w}]` (kaygan zemin), `gates [{x,y,n}]` (eleme kapısı). Hepsi level.js'te üretilir, game.js'te fiziği, render-world.js'te çizimi.
Ev sahibi haritayı seçer (veya "Rastgele"), tur sayısı 1/3/5, mod, bot doldurma (açık/kapalı; 4 kişiden azsa botlar).

## 5. Kalıcı kayıt — "gelişmelerimiz silinmemeli, otomatik"
- Kayıt zaten otomatik (`FM.persist`) ve sürümlü anahtar (`fuatmorel_save_v2`) — güncellemelerde ASLA silinmez; yeni alanlar varsayılanla eklenir (göç).
- `navigator.storage.persist()` istenir (tarayıcı veriyi kendiliğinden silmesin).
- PWA: `manifest.webmanifest` (ad "Fuat Morel", yatay, tam ekran, ikonlar) + `sw.js` (çevrimdışı önbellek, sürümlü). "Ana ekrana ekle" önerisi: ana ekrandan açılınca hep aynı depolama → ilerleme kaybolmaz.
- UYARI: WhatsApp/Instagram uygulama-içi tarayıcı ayrı depolama kullanır. Link bu tarayıcılardan açılırsa "Chrome'da/Safari'de aç ve ana ekrana ekle" bilgisi göster.
- Kayıt aktarma: Ayarlar → "Kayıt Kodu": (a) kısa bulut kodu — kayıt JSON'u `fuatmorel/v1/save/<8 karakter>` konusuna retain ile yazılır (en iyi çaba; aracı yeniden başlarsa kaybolabilir); (b) uzun çevrimdışı kod (base64). İçe aktarırken ikisi de desteklenir.
- Kalıcı oyuncu kimliği `FM.save.pid` (rastgele) ve takma ad `FM.save.nick` (ilk açılışta sorulur; varsayılan karakter adı).

## 6. Arayüz (ui.js)
- Ana menüde dev "OYNA" yanında "ARKADAŞLARLA" düğmesi → Oda Kur / Koda Katıl.
- Lobi ekranı: büyük oda kodu, "Linki Paylaş" (`navigator.share`, yoksa WhatsApp `https://wa.me/?text=` ve panoya kopyala), oyuncu listesi (portre, takma ad, karakter, ping, hazır işareti, ev sahibi tacı), ev sahibi ayarları (mod, harita, tur, botlar), "BAŞLAT" (ev sahibi), "HAZIRIM" (diğerleri), emoji gönderme.
- Link: `...index.html?oda=KOD` → açılınca doğrudan katılma (takma ad yoksa önce sor).
- Bağlantı durumu göstergesi, yeniden bağlanma, ev sahibi değişimi bildirimi, oda dolu (10) uyarısı.
- Yarışta: 10 kişilik HUD, elenme/izleyici ekranı, Altın Avı sayacı, emoji balonları.
- Sonuç/kürsü: ilk 3 kürsüde, diğerleri listede; çok oyunculuda "Sonraki tur" yalnızca ev sahibinde, diğerlerinde "Ev sahibi bekleniyor".
- Tek oyunculu ekranda mod ve harita seçimi de olsun.

## 7. Test
- `dev/net-test.js`: node ile gerçek aracıya bağlanan 3-9 sahte oyuncu (durum yayınlar, olay yollar) → tarayıcıdaki oyunun odasına katılır.
- Headless Chrome iki sekme (ev sahibi + katılan) aynı odada yarış (YAVAŞ MOD: aynı anda en fazla 2 Chrome).
