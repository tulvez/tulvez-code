# Tulvez Code katkı kuralları

## Commit mesajı formatı

Her commit aşağıdaki formatı kullanmalıdır:

```text
[ilgili alan]: içerik/ne yapıldı
```

Örnekler:

```text
[webview]: Türkçe ilk panel görünümü oluşturuldu
[git]: değişiklik analizi servisi eklendi
[docs]: geliştirme belgeleri güncellendi
```

## Alan seçimi

Commit mesajındaki alan, değişikliğin ana bölümünü belirtmelidir. Örneğin `extension`, `webview`, `git`, `ai`, `config`, `docs` veya `ci` kullanılabilir.

## Genel kurallar

- Değişiklikler küçük ve anlaşılır tutulmalıdır.
- TypeScript strict kuralları korunmalıdır.
- Kullanıcı kodu açıkça izin verilmeden Tulvez sunucusuna gönderilmemelidir.
- API anahtarları kaynak koduna yazılmamalı, VS Code SecretStorage kullanılmalıdır.
- Commit öncesi `npm run check` ve `npm run build` çalıştırılmalıdır.
