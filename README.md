# Tulvez Code

Tulvez Code, VS Code için gizlilik odaklı ve BYOK (kendi anahtarını getir) mimarisine sahip yapay zeka kodlama yardımcısıdır.

## İlk gösterim

İlk sürümde Extension Host ile React tabanlı Webview arasındaki temel iletişim hazırdır:

- Komut Paleti üzerinden `Tulvez Code: Paneli Aç` komutu
- Ana kullanım yüzeyi olarak Activity Bar içindeki Tulvez Code sidebar alanı
- İsteğe bağlı olarak editör yanında açılan ayrı Tulvez Code paneli
- shadcn/ui bileşen yaklaşımı ve Radix Slot tabanlı erişilebilir temel UI katmanı
- Koyu temalı, duyarlı Tulvez Code paneli
- Çalışma alanı adının Webview'e aktarılması
- Mesaj gönderme ve Extension Host'tan yanıt alma akışı
- Yapay zeka sağlayıcısı eklenene kadar yerel, güvenli yer tutucu yanıt

## Geliştirme

```bash
npm install
npm run check
npm run build
```

VS Code içinde `F5` tuşuna basarak Extension Development Host'u başlatın. Geliştirme modunda Tulvez Code paneli otomatik açılır. Açılmazsa Komut Paleti'nden `Tulvez Code: Paneli Aç` komutunu çalıştırın.

> Not: `npm run build` yalnızca derleme yapar; paneli açmaz. Paneli görmek için VS Code'da `F5` tuşuna basıp yeni açılan Extension Development Host penceresinde Komut Paleti'nden `Tulvez Code: Paneli Aç` komutunu çalıştırın.

Yapay zeka sağlayıcıları, Git servisleri, SecretStorage yapılandırması ve analiz komutları sonraki aşamalarda eklenecektir.

## UI mimarisi

Webview arayüzü, shadcn/ui yaklaşımındaki proje-içi bileşenlerle kurulmaktadır. Bu yaklaşımda bileşen kodu doğrudan projede tutulur ve Tulvez Code tasarımına göre değiştirilebilir.

Mevcut temel bileşenler:

- `Button`: Radix Slot ile `asChild` desteği
- `Card` ve `CardContent`
- `Textarea`
- `cn` yardımcı fonksiyonu

Bu katman Copilot benzeri kullanım akışını sağlarken, Tulvez Code renkleri, ikonları, kartları ve özel analiz görünümleri üzerine eklenebilecek bir temel sunar.

AI sohbeti için Copilot arayüzünü fork etmek yerine mevcut sidebar kabuğu korunmuştur. Copilot Chat, VS Code iç API'lerine ve kendi ürün altyapısına sıkı bağlı olduğu için bu projeye doğrudan taşınması sürdürülebilir değildir. İleride gerçek streaming/runtime ihtiyacı oluştuğunda `assistant-ui` bileşenleri ayrıca değerlendirilebilir; mevcut aşamada özel sidebar kabuğu daha hafif ve kontrol edilebilirdir.
