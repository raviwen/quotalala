# Quotalala — Proje Bilgisi (her oturumda oku)

## Proje nedir
Quotalala, kullanıcının Claude, ChatGPT (Codex) ve Gemini aboneliklerinin
kotalarını boşa harcamadan, tek bir prompt'u bu üç ajana otomatik
dağıtan yerel bir masaüstü (Electron) uygulamasıdır. Claude baş koordinatördür.

## Dağıtım hedefi (baştan buna göre tasarla)
- MIT lisanslı açık kaynak proje, GitHub Releases üzerinden dağıtılacak.
- Windows kurulum dosyası (NSIS .exe) üretilir (`electron-builder`).
- macOS ve Linux desteği ileride eklenecek şekilde tasarlanır.
- Kurulumda ve çalışma anında derleme gerektiren paket olmasın (node-pty vb. yok).

## Kesin kurallar
- API anahtarı kullanılmaz. Sadece kullanıcının kendi giriş yaptığı
  resmi CLI'lar çalıştırılır: `claude -p`, `codex exec`, `agy`.
- Giriş bilgisi dosyalarının (creds, token, auth.json) İÇERİĞİ asla
  okunmaz, kopyalanmaz. Giriş durumu CLI'ın kendi status komutuyla
  veya CLI hata çıktısıyla kontrol edilir.
- Proxy, hesap paylaşımı, aboneliği API'ye çevirme yok.
- Prompt'lar CLI'lara stdin üzerinden gönderilir.
- Gemini ajanı Antigravity CLI (`agy`) çalıştırır ve varsayılan olarak kapalıdır; Google'ın otomatik CLI kullanımına karşı bazı hesapları kısıtladığı rapor edildiğinden bu ajan kullanıcının manuel onay ve risk kabulüyle açılır.

## Mimari
- Electron tabanlı masaüstü uygulaması (Express sunucu kullanılmaz).
- Backend mantığı Electron Main Process'te çalışır (`src/main/`).
  - `main.js`: Pencere yönetimi, sistem tepsisi (tray) ikonu, yerel Windows bildirimleri.
  - `preload.js`: Güvenli IPC köprüsü (`contextBridge`, `contextIsolation: true`, `nodeIntegration: false`).
  - `cli-locator.js`: CLI yollarını bulma (.cmd / .bat / .exe ayrımı).
  - `quota.js`: Kullanıcının ev dizininde `.quotalala/quota-state.json` üzerinde kota/iş takibi.
  - `coordinator.js`: Claude tabanlı görev bölme ve sentezleme.
  - `agents/`: Her ajan ayrı modül (eklenti mimarisi: claude, codex, gemini).
- Frontend Renderer (`src/renderer/`):
  - Tek ekran, sade HTML/CSS/JS.
  - Çoklu dil desteği (i18n: tr.json, en.json, varsayılan Türkçe).
  - Main process ile asenkron IPC olayları üzerinden canlı durum ve terminal akışı.

## Koordinasyon akışı
1. Prompt önce Claude'a gider, Claude sadece JSON plan döndürür:
   alt görevler, her biri için ajan (claude/codex/gemini) ve gerekçe.
2. Backend (main process) görevleri dağıtır. Ajanlar tamamlandı / soru / başarısız / engellendi sonucu bildirir.
3. Claude ara sonuçları topluca değerlendirir; soruları yanıtlar, başka ajana danışma veya somut düzeltme görevi açar. Mesajlar yalnızca ilgili sonuç parçalarıyla aktarılır.
4. Claude yeterli sonuçta doğrudan nihai sentezi verir; ek sentez çağrısı yapılmaz. En fazla 3 yönetim turu, toplam 8 görev, görev başına 2 deneme (soru/yanıt dahil), çalışma başına 20 çağrı sınırı vardır.
5. Yeni koordinasyon oturumları managed-v1 akışını kullanır; eski kayıtlı planlar kendi akışlarıyla devam eder. Ekonomik mod tek ajanla doğrudan çalışır.

## Kota mantığı
- Her ajan için kullanım sayısı, son kullanım, son kota hatası ve
  (varsa) yenilenme zamanı tutulur.
- Kota hatası veren ajan "dolu" işaretlenir, iş diğerine aktarılır.
- Koordinatöre kota durumu her seferinde gönderilir. Öncelik: az
  kullanılan ve yenilenmesi yakın ajan. Claude kendi kotasını
  koordinasyon ve zor işler için saklar.
- Sistem tepsisi ikonu üzerine gelindiğinde ajanların anlık durumu görüntülenir.
- Windows bildirimleri ile kota yenilenmesi yaklaşan ve kullanılmamış kotası olan ajanlar hatırlatılır.

## Model seçimi (Quotalala'nın özelliği)
- Koordinatör her alt görev için hem ajanı hem modeli seçer.
  Kural: işin zorluğu ve token maliyeti. Kolay işe hafif/ucuz model,
  zor işe güçlü model. En güçlü model varsayılan olarak KULLANILMAZ.
- Model isimleri koda gömülmez. Kullanıcının home klasöründe
  `.quotalala/models.json` dosyasında durur. Her model için:
  ajan, model adı, seviye (hafif / orta / güçlü), göreli maliyet, kaynak (source).
- Model adı uydurmak kesinlikle yasak. Kaynağı gösterilemeyen model
  listeye giremez. Model listesindeki her giriş CLI çıktısı veya yerel
  ayar/kod dosyalarından doğrulanmalıdır.
- Seviye belirlerken model nesli esas alınır; isimdeki pro/flash/mini
  gibi ekler tek başına ölçüt değildir. Mümkünse alias kullanılır.
- Bir ajanda tek güçlü model varsa seviye farkı akıl yürütme/düşünme seviyesiyle sağlanır.
- Preview modelleri listeye "preview": true alanıyla eklenir;
  koordinatör bunları varsayılan seçim olarak kullanmaz.
- Uygulama ilk açılışta her CLI'ın desteklediği modelleri kendi
  komutlarıyla tespit etmeye çalışır; bulamazsa varsayılan listeyi
  kullanır.
- Ayarlar ekranında kullanıcı model listesini görüp düzenleyebilir.
- Seçilen model abonelikte yoksa hata verip durmaz: bir alt seviyeye
  veya o ajanın varsayılan modeline düşer ve akışta bunu bildirir.
- Akış kaydında her görev için "ajan + model + neden" görünür.

## Arayüz
- Aktif proje odaklı tek ekran: solda proje seçimi ve o klasörün
  konuşmaları, ortada kompakt ajan kartları ve görev kutusu, sağda
  proje hafızası. Çıktılar, etkinlik zaman çizelgesi ve günlük ayrı sekmeler.
- Klasör bir kez açılır ve son proje hatırlanır. Uygulama `--project`
  klasör argümanıyla veya proje klasöründen başlatılabilir; her görevde
  çalışma yolu yazılmaz. Geçmiş burada Quotalala'nın kendi oturumlarıdır.
- Arayüz metinleri Türkçe ve İngilizce (i18n), varsayılan Türkçe.
- Kod, değişken adları ve README İngilizce (açık kaynak standardı).

## Çalışma kuralları (geliştirme yapan ajan için)
- Bu kurallar Quotalala'yı geliştirirken senin davranışınla ilgilidir,
  uygulamanın kendi model seçimini kısıtlamaz.
- Testlerde kotayı koru: her CLI'a tek ve çok kısa prompt yeter
  ("OK yaz"). Testlerde mevcut en hafif modeli kullan; çalışmazsa
  varsayılana dön, model denemeleriyle vakit kaybetme.
- Dosya silmeden veya proje dışına bir şey yazmadan önce kullanıcıya sor.
- Her büyük adımdan sonra ne yaptığını kısaca özetle.
- Kullanıcı onay vermeden git commit atma.

## Yol haritası
1. Sağlık testi ekranı ve CLI entegrasyonu (Tamamlandı)
2. Electron masaüstü mimarisi, IPC köprüsü, Sistem Tepsisi ve Bildirimler (Tamamlandı)
3. Arayüz i18n (TR/EN) ve tekil ajan prompt testi (Tamamlandı)
4. Claude koordinatör ile çoklu ajan görev dağıtımı (Tamamlandı)
5. Kota takibi, oran sınırları ve otomatik görev devri (Tamamlandı)
6. Model seçimi: models.json, zorluk/maliyet bazlı seçim, geri düşme (Seviye seçimi, ayarlar ve CLI varsayılanına geri düşme tamamlandı; otomatik model keşfi `model-discovery.js` olarak uygulandı ve test edildi, yalnızca Ayarlar'daki keşif/onay arayüzü bekliyor)
7. electron-builder ile NSIS Windows Installer (.exe) ve GitHub Releases hazırlığı (Yerel NSIS üretimi, paket doğrulama ve GitHub kontrol akışı hazır; GitHub üzerinde çalıştırma, temiz kurulum testi, imzalama kararı ve yayın bekliyor)
8. Gemini düşünme seviyesi kontrolü (CLI desteği netleşince)
9. Geçmiş & proje hafızası: yerel oturumlar, devam etme, 2000 karakter özet, gizlilik ayarları (Tamamlandı)
10. Günlük iyileştirmeleri: seçme/kopyalama, filtreler, yapılandırılmış hata kartları ve ortak sağlık durumu (Tamamlandı)
11. Etkinlik zaman çizelgesi: yapılandırılmış koordinasyon olayları, tıklanabilir girdi/çıktı, son 20 başlıkla proje bağlamı ve oturuma devam etme (Tamamlandı)
12. Görev sonucu doğrulama: CLI çıkış kodundan ayrı engellenme/başarısızlık, incelemede dosya-satır kanıtı ve ortak erişim engelinde gereksiz tekrarları durdurma (Tamamlandı)
13. Aktif proje, klasöre göre otomatik konuşma/hafıza yükleme, son projeyi hatırlama ve modern masaüstü arayüzü (Tamamlandı)
14. npm başlatıcısı: proje klasöründe `quotalala` / `npx quotalala`, Electron ile bağımsız paket ve paket içerik doğrulaması (Tamamlandı; npm `quotalala@1.1.0` yayımlandı)
15. Çok dilli README: Q logosu, hızlı kurulum, dil bağlantıları ve EN/TR/DE/ES/FR kullanım belgeleri (Tamamlandı; 1.1.0 güncelleme notları ve örnek Electron ekran görüntüleri eklendi)
16. Ekonomik mod ve kota sınırları: tek ajan/seviye, en fazla 8 alt görev, görev başına 2 deneme ve çalışma başına 20 çağrı; başarısız/aynı çıktıda hafıza çağrısını atlama (Tamamlandı; 256 sonuç özetiyle tekrar tespiti, hafıza 2000 karakter)
17. Canlı stdout/stderr, süreç ağacını durdurma, ayarlanabilir zaman aşımı, kısmi çıktı ve eksik adımdan devam (Tamamlandı; Windows yerel süreç ve mock ajan testleri; macOS/Linux testi bekliyor)
18. İsteğe bağlı düzenlenebilir plan onayı, backend doğrulaması ve Claude olmadan doğrudan ajan seçimi (Tamamlandı)
19. Ajan beyanı/doğrulanan sonuç ayrımı, yerel dosya metaverisi, CLI komut/çıkış kodu kanıtları ve isteğe bağlı ek doğrulama (Tamamlandı; yapılandırılmış komut kanıtı şu an Codex; sentez bağımsız test sayılmaz)
20. Tek Electron örneği, etkin görevde proje isteğini bekletme, benzersiz atomik kayıt, kesilen oturumları kurtarma ve özet tabanlı geçmiş (Tamamlandı; eski kayıtların ilk dönüşümü bir kez tam okuma yapar)
21. Claude yönetim döngüsü: ajan soruları, Claude yanıtları, kontrollü ajanlar arası danışma, somut düzeltme görevleri, görünür ekip konuşması, sonraki tur plan onayı ve devam durumunun kaydı (Tamamlandı; en fazla 3 yönetim turu, kotasız mock ve üretim Electron arayüz testleri; gerçek abonelik çağrısı yapılmadı)
22. Küçük ekip odası: gerçek görev olaylarından çalışan masalar, soru/yanıt balonları, tıklanabilir ve kopyalanabilir mesajlar, geçmiş/iptal durumları ve azaltılmış hareket desteği; arka planda bitiş/engel/plan onayı bildirimleri ve doğru oturuma geçiş (Tamamlandı; ek CLI çağrısı yok, Gemini risk onayı korunur; masaüstü bildirim sunumu işletim sistemi ayarlarına bağlı)

23. 1.1.0 sürüm belgeleri ve ekran görüntüleri: EN/TR/DE/ES/FR README güncelleme notları, örnek verilerle gerçek Electron görselleri ve npm paketinde belge varlıklarının doğrulanması (Tamamlandı; üç görsel npm paketinde doğrulandı; 1.1.0 npm latest olarak yayımlandı, arşiv bütünlüğü ve GitHub kontrolleri doğrulandı)

24. 1.3.0 sürümü: oturum devam ettirme (worker ve koordinatör CLI oturumu resume), yapılandırılabilir görev bütçeleri, kota mantığının netleştirilmesi, koordinatör varsayılanı Sonnet ve arayüz onarımları; sürüm 1.3.0'a yükseltildi, CHANGELOG ve beş dilde README güncelleme notları yazıldı (Tamamlandı; `npm run check`, 107 test ve arayüz testi geçti; gerçek abonelik çağrısı yapılmadı, npm yayını ve NSIS dosyası bekliyor)
