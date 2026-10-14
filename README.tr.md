<p align="center">
  <img src="assets/icon.png" alt="Quotalala Q logosu" width="104" height="104">
</p>
<h1 align="center">Quotalala</h1>
<p align="center">Tek prompt. Senin projen. Claude, Codex ve isteğe bağlı Gemini.</p>
<p align="center">
  <a href="README.md">🇬🇧 English</a> · <strong>🇹🇷 Türkçe</strong> · <a href="README.de.md">🇩🇪 Deutsch</a> · <a href="README.es.md">🇪🇸 Español</a> · <a href="README.fr.md">🇫🇷 Français</a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/quotalala">npm</a> · <a href="LICENSE">MIT</a> · Windows · Node.js 22.12+
</p>

Quotalala, kendi hesabınla giriş yaptığın yapay zekâ CLI araçlarını birlikte çalıştıran yerel bir Electron masaüstü uygulamasıdır. Projenin içinde aç, tek bir prompt yaz; Claude işi planlasın, görevleri dağıtsın ve sonuçları kontrol etsin. O projeye ait kayıtlı konuşmalar ve hafıza otomatik yüklenir.

## Projenin içinde başlat

Terminali **üzerinde çalışmak istediğin proje klasöründe** aç:

```powershell
npx quotalala
```

Ya da bir kez kurup kısa komutu kullan:

```powershell
npm install -g quotalala
quotalala
```

Bulunduğun klasör, `.git` veya proje tanım dosyası olmasa da ajanların çalışma klasörü olur. Başka bir projeyi açmak için:

```powershell
quotalala --project "C:\projects\my-app"
```

**Gereksinimler:** Windows, Node.js 22.12+ ve kurulu, giriş yapılmış `claude` ile `codex` CLI araçları. Girişi `claude auth status` ve `codex login status` ile kontrol edebilirsin. İsteğe bağlı Gemini ajanı `agy` kullanır. İlk npm kurulumu Electron'u indirir; ayrıca Quotalala kurulum dosyası veya yerel derleme gerekmez. Komut masaüstü penceresini açar.

## Ne değişiyor?

| Elle çalışırken | Quotalala ile |
| --- | --- |
| Her ajana aynı bağlamı yeniden anlatırsın | Tek prompt gönderirsin; Claude plan oluşturur |
| Her görev için ajanı kendin seçersin | Görevlerde ajan, model seviyesi ve seçim nedeni görünür |
| Araçlar arasında sonuç kopyalarsın | Koordinatör görev çıktılarını aktarır |
| Nerede kaldığını yeniden toparlarsın | Projenin konuşmalarını, zaman çizelgesini ve düzenlenebilir hafızasını açarsın |

1. **Plan:** Claude yerel kota durumunu ve proje bağlamını dikkate alarak işi görevlere böler.
2. **Yürütme:** Görevler Claude, Codex veya etkinleştirilmiş Gemini'ye gider. Kota hatasında görev devredilebilir; kullanılamayan model yerine CLI'ın varsayılan modeli denenir.
3. **Kontrol:** Claude sonuçları birleştirip kontrol eder. Zaman çizelgesi görev dağılımını, aktarımları ve hataları gösterir; adımların girdi ve çıktıları açılabilir.

Yönlendirme yerel kullanım ve kota hatası kayıtlarına dayanır. Sağlayıcının kotasını canlı ölçmez; daha az kullanım garantisi vermez.




## Küçük ekip odası

Ana ekranda küçük bir çalışma odası var: Claude ekibi yönetir, Codex geliştirir; isteğe bağlı Gemini araştırır. Masalar gerçek görev olaylarına göre çalışıyor, yanıt bekliyor, yanıt alıyor, tamamlıyor veya duruyor. Mesaj balonuna ya da alttaki iletim satırına tıklayarak gerçek mesajı açıp kopyalayabilirsin. Mevcut sağlık ve model kontrolleri **Bağlantılar ve ajan ayrıntıları** altında; yer açmak için odayı küçültebilirsin.

Oda için **ek CLI çağrısı yapılmaz**. Ajan soruları ve yanıtları mevcut Claude yönetim akışında otomatik iletilir. Gemini kapalıysa kapalı kalır; geçmiş kayıtları etiketlenir, iptal ve geçmiş görünümünde çalışma animasyonları durur. Sisteminin azaltılmış hareket tercihi desteklenir.

Uygulama arka plandayken iş bittiğinde, eksik/engellenmiş sonuç oluştuğunda veya plan onayın gerektiğinde sessiz masaüstü bildirimi gelir. Bildirime tıklamak ilgili oturumu açar; işi başlatmaz veya tekrarlamaz. Ajanların kendi aralarındaki konuşmalar ve senin iptallerin masaüstü uyarısı oluşturmaz. **Ayarlar → Görev bildirimleri** ile kapatabilirsin. Bildirimlerde istem veya cevap içeriği bulunmaz; teslimi işletim sisteminin bildirim ayarlarına bağlıdır.

## Ekibi Claude yönetir

Koordinasyon modunda Claude, ilk plandan sonra da yönetimi sürdürür. Ajanlar sonuç veya soru gönderebilir. Claude bağımsız sonuçları birlikte değerlendirir; bekleyen ajana yanıt verir, açık bir ajana kısa danışma görevi atar veya somut bir düzeltme görevi açar. Cevap, ihtiyaç duyan ajana aktarılır. Soru, karar ve yanıtlar **Ekip konuşması** bölümünde ve zaman çizelgesinde seçilip kopyalanabilir.

Son yönetim yanıtı nihai sentezi de içerir; ayrı sentez çağrısı yapılmaz. Yönetim hafif seviyede ve en fazla **3 turda** çalışır. İlk işler, danışmalar ve düzeltmeler aynı **8 görev / görev başına 2 deneme / çalışma başına 20 çağrı** sınırını paylaşır. Ajanın soru sorması ve cevaptan sonra devam etmesi de deneme harcar. Tamamlanan işler korunur; düzeltmeler ayrı adımlardır. Plan önizlemesi açıksa sonraki turdaki işler ve yanıtlar da düzenlenebilir onaya gelir.

Bağlam maliyeti için her aktarımda en fazla 3 ilgili çıktının 1600'er karakterlik parçaları paylaşılır. Yeni ekip çağrıları, bütün yerel CLI konuşmasını yeniden taşımak yerine gerekli bağlamla ayrı konuşmalarda çalışır. Tam çıktılar yerel geçmişte kalır. Uzun çıktının paylaşılan kısmı kesilebilir; sınır dolduğunda başarı iddiası yerine kısmi sonuç verilir. Eski kayıtlı planlar önceki akışını korur. Gemini açık risk onayıyla etkinleştirilir. Daha az kullanım hedeftir; kesin kota tasarrufu garantisi değildir.

## Çalıştırma kontrolleri ve sonuç kanıtları

- **Ekonomik mod:** tek ajan ve seviye seçerek doğrudan çalıştır. Başarılı çalışmada tek prompt çağrısı yapılır; planlama, sentez, hafıza ve ek doğrulama çağrıları atlanır. Claude kullanılamıyorsa uygun başka bir ajan seçebilirsin. Model/oturum geri düşmesi bir ek deneme kullanabilir.
- **Plan onayı:** çalıştırmadan önce planı göster seçeneğiyle başlıkları, istemleri, gerekçeleri ve ajan/seviye seçimlerini değiştir veya görevleri kaldır. Backend düzenlenen planı ve ajanların güncel kullanılabilirliğini yeniden doğrular. Modeller doğrulanmış katalogdan seçilir.
- **Sınırlar:** en fazla 8 alt görev, görev başına toplam 2 prompt denemesi (model geri düşmesi ve görev devri dahil), çalışma başına 20 prompt çağrısı. Aynı başarısız işlemin tekrarı atlanır. Çağrı başına zaman aşımı 1–1800 saniye arasında ayarlanabilir; varsayılan 180 saniyedir. Yardım keşfinin ayrı 10 saniyelik sınırı vardır.
- **Canlı çıktı ve Durdur:** stdout/stderr güvenli IPC ile gösterilir; seçilip kopyalanabilir. Durdur süreç ağacını sonlandırır, sıradaki işleri başlatmaz ve iptali hatadan ayrı kaydeder. Tamamlanan adımlar ve kısmi çıktı korunur. Bazı CLI çıktı biçimleri metni yalnızca işlem sonunda gönderir.
- **Devam:** iptal edilmiş, başarısız veya beklenmedik kapanmış oturumun planı ve başarılı sonuçları kullanılır; yalnızca eksik adımlar çalışır. Yarım kalan adımın dosyalara yaptığı işlemler geri alınmaz; yeniden denemeden önce kısmi değişiklikleri incele. Tamamlanmış konuşmaya yeni bir istem eklenebilir.
- **Kanıtlar:** sıfır çıkış kodu tek başına başarı kanıtı değildir. Ajanın bildirdiği sonuç ve bağımsız olarak doğrulanmamış sonuç ayrı gösterilir. Yerelde gözlenen dosya değişiklikleri, ajanın dosya/satır referansları ve CLI'ın sunduğu komut/çıkış kodu olayları (şu an Codex) görüntülenir. İncelemelerde dosya/satır kanıtı aranır; genel açıklamalarda aranmaz. Claude sentezi bağımsız test değildir. İsteğe bağlı ek doğrulama kota kullanır; yalnızca elde edilen rapor ve komut kanıtları gösterilir.
- **Hafıza ve geçmiş:** yalnızca başarılı ve yeni çıktı hafıza çağrısını tetikler; aynı çıktılar oturumlar arasında en fazla 256 özet değerle hatırlanır. Hafıza 2000 karakterle sınırlıdır. Geçmiş küçük özet kayıtlarından listelenir; tam çıktı gerektiğinde yüklenir. Eski kayıtların ilk dönüşümü büyük geçmişlerde zaman alabilir.
- **Tek uygulama örneği:** ikinci açılıştaki proje isteği mevcut pencereye iletilir; görev sürüyorsa bekletilir. Görevin çalışma klasörü değişmez. Atomik kayıtlarda benzersiz geçici dosyalar kullanılır. Beklenmedik kapanan oturumlar açılışta işaretlenir ve geçmişten devam edilebilir.

Dosya tarihleri ve boyutları içerik doğruluğunu veya değişikliği yalnızca ajanın yaptığını kanıtlamaz. Yapılandırılmış olay sunmayan Claude/agy kontrolleri ajan beyanı olarak kalır. Ani kapanmada canlı çıktının son yaklaşık bir saniyesi kaybolabilir; kurtarma için kayıt açık olmalıdır. Windows süreç ağacı temizliği test edildi; macOS/Linux platform testleri bekliyor.

## Projen kaldığın yeri hatırlar

- Konuşmalar projeye göre gruplanır. Oturum açabilir, adını değiştirebilir, silebilir veya devam edebilirsin.
- Başarılı ve yeni çıktı üreten koordinasyon çalışmalarında Claude en fazla **2000 karakterlik** proje özetini günceller. Özeti elle düzenleyebilirsin. Planlamaya en fazla **20 etkinlik başlığı** da eklenir.
- Çıktılar ve günlük seçilip kopyalanabilir. Günlüğü seviyeye veya ajana göre filtreleyebilir; hata kartlarında önerilen çözümü ve kopyalanabilir ham çıktıyı görebilirsin.

`Ctrl+N` yeni konuşma açar. `Ctrl+Enter` prompt'u gönderir. Uygulama arayüzü Türkçe ve İngilizcedir; README çevirileri arayüze yeni dil eklemez.

## Yerel kayıtlar ve izinler

API anahtarı, giriş bilgisi dosyalarını okuma, proxy veya hesap paylaşımı yoktur. Prompt'lar kendi giriş yaptığın resmî CLI'lara stdin üzerinden gönderilir. Oturumlar `~/.quotalala/sessions/`, hafıza `~/.quotalala/memory/` altında JSON olarak tutulur. Ayarlardan kaydı kapatabilir veya geçmişi temizleyebilirsin; proje hafızasını düzenleyebilir ya da sıfırlayabilirsin. CLI'lar kendi konuşmalarını ayrıca saklayabilir.

Tanınabilen anahtarlar ve token'lar kaydedilmeden önce maskelenir. Kalıplara dayanan maskeleme her gizli bilgiyi yakalayamaz; paylaşmadan önce çıktıyı gözden geçir. Bir klasörü açmak CLI'ın güvenlik politikasını aşmaz. CLI'ın normal kapanması, erişimi engellenmiş incelemenin başarılı sayılması için yeterli değildir.

> **Gemini varsayılan olarak kapalıdır.** `agy` açılmadan önce karttaki risk uyarısının kabul edilmesi gerekir. Uyarı, otomatik kullanımla bağlantılı olduğu bildirilen hesap kısıtlamalarını açıklar. Geliştirme ortamında doğrulanmamış Gemini model adları pakete eklenmez.

## Masaüstü kurulum dosyası

Windows NSIS kurulum dosyası da üretilebilir; bu sürüm Node.js gerektirmez:

```powershell
& "C:\path\to\Quotalala.exe" --project "C:\projects\my-app"
```

Uygulama `.git`, `AGENTS.md` veya `package.json` gibi bir işaret bulunan klasörden başlatıldığında o projeyi algılar. Diğer durumda son projeyi hatırlar. Kenar çubuğundan proje değiştirebilir veya ilk klasörü açabilirsin. Henüz kurulum dosyası içeren bir Release yayımlanmadı; yerelde doğrulanan dosya imzasızdır.

<details>
<summary><strong>Geliştirme, test ve paketleme</strong></summary>

Klonladığın Quotalala deposunda çalıştır:

```powershell
npm ci
npm start
npm test
npm run test:ui
npm run test:startup
npm run test:instance
npm run check
npm run pack:cli
npm run build -- --win --publish never
```

Başka bir projeyle geliştirme testi için `npm start -- --project "C:\projects\my-app"` kullan. Testler sahte CLI'lar ve yerel örnek veriler kullanır. Gerçek kota testleri açık izin gerektirir: [AGENTS.md](AGENTS.md).

`pack:cli`, sabitlenmiş Electron bağımlılığıyla bağımsız npm arşivi oluşturur ve dosya listesini doğrular. Kök geliştirme tanımı yerine üretilen arşiv yayımlanmalıdır. NSIS üretiminde Electron geliştirme bağımlılığı olarak kalır. Paketleme komutları otomatik yayın yapmaz.

Modeller, kaynak bilgisiyle `~/.quotalala/models.json` içinde tutulur ve Ayarlar'dan düzenlenebilir. Preview modeller varsayılan seçimlerden çıkarılır. Otomatik model keşfi ve Gemini düşünme seviyesi kontrolü henüz tamamlanmadı. macOS ve Linux desteği planlanıyor.

Yayın kontrolleri ve bilinen derleme bağımlılığı uyarıları: [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md). Arayüz korumalı renderer, bağlam yalıtımı ve sınırlı IPC köprüsü kullanır. Backend `src/main/`, arayüz `src/renderer/` içindedir.

</details>

## Lisans

[MIT](LICENSE) · Quotalala Contributors
