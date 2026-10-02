# Tulvez Code

Tulvez Code, VS Code için gizlilik odaklı ve BYOK (kendi anahtarını getir) mimarisine sahip yapay zeka kodlama yardımcısıdır.

## İlk gösterim

İlk sürümde Extension Host ile React tabanlı Webview arasındaki temel iletişim hazırdır:

- Komut Paleti üzerinden `Tulvez Code: Paneli Aç` komutu
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

VS Code içinde `F5` tuşuna basarak Extension Development Host'u başlatın. Ardından Komut Paleti'nden `Tulvez Code: Paneli Aç` komutunu çalıştırın.

Yapay zeka sağlayıcıları, Git servisleri, SecretStorage yapılandırması ve analiz komutları sonraki aşamalarda eklenecektir.
