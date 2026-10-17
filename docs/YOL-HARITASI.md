# FUAT MOREL — Yol Haritası (kullanıcı istekleri + ana ajanın fikirleri)

Bu dosya, konuşmalarda istenen ve önerilen her şeyin unutulmaması için tutulur. Her tur bitince durum güncellenir.
Durum: ✅ bitti · 🔨 bu turda yapılıyor · 📋 sırada · 💡 öneri

**Vizyon (kullanıcı):** "Fun Run 4 oynanışı gibi olup onun kalitelisini istiyoruz ve bizim oyunumuz olsun."
**Yayın kuralı (kullanıcı onayı, 16.10.2026):** testten geçen düzeltmeler her seferinde sormadan `main`'e (oyunun linkine) gönderilir; kullanıcıya ne değiştiği yazılır.

## Kullanıcının istekleri
- ✅ Eşya ve güç belirgin değil, "bence oyundaki her şey" → belirginlik turu (TUR5 §3)
- ✅ Eşya/gücü yön tuşlarıyla/sürükleyerek atma (Fun Run gibi) → yönlü atış (TUR5 §2)
- ✅ Harita ekranın üstünde kalıyor → kamera: zemin ~%70, karakterler biraz büyük (TUR5 §4)
- ✅ Oynanış hissi → zıplama tamponu, affedici tehlikeler, ısınma (TUR5 §5)
- ✅ Herkes hazır olunca otomatik başlasın, ev sahibinde HEMEN BAŞLAT (TUR5 §6)
- ✅ Lobi unutulmasın: turlar arası otomatik devam, maç sonu lobiye dönüş, sayfa yenilenince odaya geri dönüş (TUR5 §7)
- ✅ Çevrimiçi listesi + KATIL (TUR5 §8)
- ✅ Herkesin kupası 0'dan başlasın (TUR5 §8.1)
- ✅ Herkes birbirinin kaç saat oynadığını, çevrimiçi olup olmadığını, kaç dk önce görüldüğünü görsün (TUR5 §8)
- ✅ "Kral çevrimiçi değil ama çevrimiçi görünüyor" → uydurma çevrimiçi verisi kaldırılıyor, gerçek varlık (TUR5 §8.3)
- ✅ Arkadaş çevrimiçi olunca bildirim (oyun açıkken/arka plandayken; tamamen kapalıyken push sunucusu olmadan mümkün değil) (TUR5 §8.4)
- ✅ Mağazayı geliştir (Mağaza 2.0: 82 ürün, şapka/aksesuar, desenli görünümler, kutlama, ölüm efekti, nadirlik, Günün Vitrini, canlı önizleme, plakada takma ad): plakalarda karakter adı ("Kral") değil oyuncunun takma adı; isimlere/takma adlara bağlı olmayan, çok çeşitli ürünler ("sen farklı farklı şeyler yap")
- 📋 "Dallanıp budaklanan çok yer var, sen düşün geliştir": arkadaşlarla oynama, karakterler, süs, oynanış, özel güçler
- ✅ "Karakterler Fun Run 4'e göre çok büyük, telefona göre küçült" → telefonda görüş yüksekliği 520 (karakterler ekranın ~%12'si)
- ✅ "Karakter kalitesi telefonda düşüyor, herkes yüksek çözünürlükte oynasın" → cihazın kendi DPR'si (en çok 3), yüksek DPR'de 2'nin altına inmez
- ✅ "Düğmeleri de ölçekli küçült, zıplama tuşu çok büyük" → dokunmatik düğmeler ~%25 küçük
- ✅ "Safari üst çubuğu çok büyük, tam ekran seçeneği koy" → iPhone'da TAM EKRAN rehberi (Ana Ekrana Ekle) + kayıt taşıma
- ✅ "Oda kurunca link paylaşmak gerekmesin, odalar herkese görünsün; kim oyuna girdi/kim oda kurdu anlık küçük bildirim" → ARKADAŞLARLA'da AÇIK ODALAR + KATIL, menüde "n açık oda", "X oyuna girdi!" / "X oda kurdu!" bildirimi (yarışta küçük)
- ✅ "Harita göz yoruyor, hasar veren cisimler belirgin olsun, zıplama/kayma görünsün" → sakin arka planlar, ortak kırmızı tehlike dili, yumuşak mürekkep
- ✅ "Haritaya biraz daha yakın olalım" → telefon görüşü 460
- ✅ "Atarken daha mantıklı olsun" + "sürüklerken testere elimde kaldı" → yukarı = ileri-yukarı kavis, parmak düğmeden taşsa da atış kaybolmaz, kendi testeren/dinamitin sana zarar vermez
- ✅ "Zıplarken ve kayarken hız yavaşlamalı" → zıplama %8 (+havada %10), kayma %20 hız keser
- ✅ "Çok ping var" → WebRTC doğrudan bağlantı (STUN; olmazsa MQTT yedeği), en hızlı aracı seçimi, daha az ara değerleme gecikmesi, lobide DOĞRUDAN rozeti
- ✅ "Akıcılık Fun Run 4 gibi değil" → çizim ara değerlemesi, çevik koşu adımı, kısa vuruş donması, daha hızlı düşüş (1.22×), kilitli kamera
- ✅ "Atılan şey havada kalıyor, düşmeli, zemine sabitlenmeli" → ağ/tuzak yere düşüp oturur, sıvıda söner; buz dalgası, mürekkep cephesi, Nuss süzülüşü düzeltildi
- ✅ "Kaymadan geçiyorsun, bazı yerlerde zıplamak çözüm değil" → dev/obstacles.js denetleyicisi: 93 ihlal → 0 (testere makineleri ayakta geçilmiyor, imkânsız çukur/duvar yok)
- 🔨 "Kapan gözükmüyor" → kapan %25 büyük + üstünde zıplayan kırmızı ⚠ (çimin önünde)
- 🔨 "İnsanlar ne yapacağını anlamıyor" → ipucu sistemi (ZIPLA/ÇİFT/KAY/TIRMAN işareti + tuş nabzı), motor FM.S.hint
- 🔨 "Lav da dahil hiçbir yere düşüp ölme olmasın" (Fun Run 4 gibi) → motor ajanı
- 🔨 **BÜYÜK GÜNCELLEME / App Store**: docs/APP-STORE-PLANI.md — Türk tiplemeleri (ilk parti: Almancı Dayı, Terlikli Teyze, Simitçi Martı), futbol renkleri formaları, ekonomi/sezon bileti, öğretici giriş, sunucu planı
  - 🔨 İlk 3 tipleme: çizim + animasyon ✅, karakter açma (10.000 altın ya da 100 elmas, kilitli kart, AÇ düğmeleri, LAFLARI) ✅, özel güçler (motor) 🔨, kadroya ekleme 📋
  - ✅ Futbol formaları (yalnızca renk): kalın şeritli forma + kısa kol + şort + tozluk, mağazada takım renkli forma kartı
  - 🔨 İlk deneyim: hoş geldin ekranı + antrenman yarışı (koç zamanı yavaşlatıp ZIPLA/KAY/TIRMAN/ÇİFT/EŞYA/GÜÇ gösterir) ✅; kolay botlar + sabit kolay pist (motor) 📋
- Not: Fable'ı az kullan (kullanıcı: çok token yiyor) → küçük işleri ana ajan yapar, Fable yalnızca gerçek çizim işlerinde ve kısa görevle
- Not: "Karakterler güzel, eline sağlık" → karakter tasarımlarının ana hatları korunur.

## Ana ajanın fikirleri
- ✅ Rüzgâr arkası (draft), kusursuz iniş ödülü, kıl payı geri bildirimi (TUR5 §11)
- ✅ Ligler (Bronz → Efsane), kafa kafaya skor ("Kral'a karşı 12-8"), maç sonu eğlenceli ödüller (TUR5 §11)
- ✅ Ekran dışı rakip okları, vurulma yönü, nişan yardımı, geride kalana daha iyi eşya, solak düzen, düğme boyutu, titreşim (TUR5 §9)

### 6. tur önerisi (bu turdan sonra)
- ✅ **Mağaza 2.0**: nadirlik (Sıradan/Nadir/Destansı/Efsanevi), günlük değişen vitrin, canlı önizleme (karakter üstünde hareketli), yeni kategoriler: zafer kutlaması, ölüm efekti, şapka/aksesuar, yeni görünüm desenleri, yeni izler, yeni plakalar (takma adla önizleme). Hiçbiri karakter adlarına bağlı değil.
- 💡 **Özel güçler 2.0**: her güce seviye 3 ve 5'te "evrim" (ikincil etki), karakter ekranında güç için kısa animasyonlu önizleme, güçlerin karşı hamlesi (ör. kalkan güce karşı ne yapar) netleşir.
- 💡 **Arkadaşlarla 2.0**: Takım modu (2v2/3v3, takım arkadaşı eşyaları zarar vermez, takım puanı), oda kuralları (eşyalar açık/kapalı, güçler açık/kapalı, hız), hazır cümlelerle hızlı sohbet ("İyi oyundu!", "Rövanş?"), rövanş oylaması, haftalık klan sıralaması (profil kartlarından).
- 💡 **Oynanış 2.0**: Günün Haritası (herkese aynı tohum, en iyi süre tablosu), kendi en iyi koşunun hayaleti, ilk açılışta 30 sn'lik öğretici koşu.
- 💡 **Karakterler**: karakter başına zafer/yenilgi animasyonları ve ifadeler (tasarımlar korunarak).
