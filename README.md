# ♠ Fuat Morel

Klanın kendi Fun Run'ı. Tarayıcıda oynanan, 4 kişilik, eşyalı ve özel güçlü 2D engelli koşu yarışı.

**Oyna:** GitHub Pages açıldıktan sonra `https://KULLANICI_ADIN.github.io/fuat-morel/`

## Karakterler
Hepsinin hızı, zıplaması ve güç dolumu aynı; fark sadece görünüş ve özel güçte.

| Karakter | Özel güç |
|---|---|
| TAFTAF (kedi) | Gölge Atılımı |
| Caner (karga) | Kızıl Ay Kargaları |
| LUL (goril) | Goril Yumruğu |
| ertan (penguen) | Buz Kızağı |
| Kral (aslan) | Kral Kükremesi |
| Nuss (baykuş) | Tüy Süzülüşü |
| baso (ayı) | Bas Dalgası |

## Kontroller
- **Zıpla:** Boşluk / ↑ / W (havada tekrar bas: çift zıplama, duvarda basılı tut: tırmanma)
- **Kay / yere çakıl:** ↓ / S
- **Eşya:** E / Shift
- **Özel güç:** Q / F
- **Duraklat:** Esc / P
- Telefonda ekrandaki düğmeler (telefonu yan çevir).

## GitHub Pages'te yayınlama
1. github.com'da **New repository** → adı `fuat-morel` → **Public** → Create.
2. Bu klasörde:
   ```
   git remote add origin https://github.com/KULLANICI_ADIN/fuat-morel.git
   git push -u origin main
   ```
3. Repo sayfasında **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main / (root) → Save**.
4. 1-2 dakika sonra oyun `https://KULLANICI_ADIN.github.io/fuat-morel/` adresinde açılır. Linki arkadaşlarına gönder.

İlerleme (altın, görevler, geliştirmeler) her oyuncunun kendi tarayıcısında saklanır.

## Geliştirici
- `node dev/sim.js 8 [mod] [tema|all] [yarışçı]` — oyun mantığını tarayıcısız simüle eder (ör. `node dev/sim.js 8 elim all 10`; mod: classic, elim, coins, pure, chaos; tema 0-7 ya da id).
- `node dev/deathloop.js 20 1000 [tema] [mod]` — ölüm döngüsü / bitiremeyen yarışçı avcısı.
- `node dev/shot.js "scene=race&t=8&theme=0" cikti.png 1280 720` — headless Chrome ile ekran görüntüsü (scene: race | podium | menu, theme: 0 orman, 1 şeker, 2 kar, 3 kale, 4 çöl, 5 uzay, 6 şehir, 7 tropik; mode=elim, n=10 gibi parametreler de olur).
- `node dev/net-test.js 1` — çok oyunculu ağ katmanını gerçek MQTT aracısına karşı sahte oyuncularla dener (0 EMQX, 1 Mosquitto, 2 HiveMQ, all).
- `node dev/net-browser.js` — oyunu headless Chrome'da ev sahibi yapıp node oyuncularla aynı odada dener.
- Modül sözleşmesi: `docs/CONTRACT.md`; çok oyunculu tasarım ve `FM.net` API'si: `docs/MULTIPLAYER.md`.
