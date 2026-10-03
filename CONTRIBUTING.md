# Katkı Kuralları

Tulvez Code'a katkılar **fork + Pull Request** üzerinden alınır. Hiçbir katkı doğrudan `master`'a merge edilmez; tüm PR'lar proje bakımından atanmış en az bir kişi tarafından incelenip onaylandıktan sonra merge edilir.

## Nasıl katkı verilir?

1. Repoyu fork'la ve yereline klonla
2. `master`'dan bir feature branch aç (`feat/kısa-aciklama` veya `fix/kısa-aciklama`)
3. `npm run check` ve `npm run build`'in temiz geçtiğinden emin ol
4. Küçük ve odaklı değişiklikler için PR aç: neyi değiştirdiğini ve nedenini kısaca yaz
5. PR açıldığında otomatik CI (`npm ci → check → build`) çalışır; yeşil olursa bakımcı incelemesine alınır

## Kurallar

- Commit mesajları Türkçe, küçük harf ve `[kapsam]:` önekiyle: `[webview]:`, `[ai]:`, `[infra]:`, `[docs]:`
- Mock/sahte çalışma zamanı kodu kabul edilmez; feature'lar gerçek sağlayıcı API'leriyle doğrulanmalıdır
- API anahtarı, token veya kişisel veri commit'lenmez
- Büyük özellikler önce issue açılarak tartışılmalı
