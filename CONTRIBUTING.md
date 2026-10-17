# Katkı Kuralları

Tulvez Code'a katkılar **fork + Pull Request** üzerinden alınır. Hiçbir katkı doğrudan `master`'a merge edilmez; tüm PR'lar proje bakımından atanmış en az bir kişi tarafından incelenip onaylandıktan sonra merge edilir.

## Nasıl katkı verilir?

1. Repoyu fork'la ve yereline klonla
2. `master`'dan bir feature branch aç (`feat/kısa-aciklama` veya `fix/kısa-aciklama`)
3. `npm run check` ve `npm run build`'in temiz geçtiğinden emin ol
4. Küçük ve odaklı değişiklikler için PR aç: neyi değiştirdiğini ve nedenini kısaca yaz
5. PR'da `npm run check` ve `npm test` çıktısını yazıya yapıştırın. Depoda PR
   tetikli otomatik CI yoktur (bilinçli tercih); doğrulama PR'ın sorumluluğundadır
6. Yayınlama için `v*` etiketi itilir. `.github/workflows/publish.yml` yalnızca
   bu tetikleyicide çalışır: kurulum, tip kontrolü, test, derleme ve ardından
   VSIX'i Marketplace'e yayınlama. Sürüm numarasında `-beta`, `-alpha` veya `-rc`
   varsa otomatik olarak pre-release olarak işaretlenir

## Kurallar

- Commit mesajları Türkçe, küçük harf ve `[kapsam]:` önekiyle: `[webview]:`, `[ai]:`, `[infra]:`, `[docs]:`
- Mock/sahte çalışma zamanı kodu kabul edilmez; feature'lar gerçek sağlayıcı API'leriyle doğrulanmalıdır
- API anahtarı, token veya kişisel veri commit'lenmez
- Büyük özellikler önce issue açılarak tartışılmalı

## Commit kimliği

Bu repoya üretilen commit'ler bir GitHub App bot kimliğiyle imzalanır:

```
user.name  = Tulvez Code
user.email = 343685009+tulvez-code[bot]@users.noreply.github.com
```

Amaç, ajanın ürettiği kodu repo geçmişinde insan katkıcısından ayırmaktır.
Bu ayarlar **yalnızca bu repo için** geçerlidir (`.git/config`), global git
kimliğinizi değiştirmez.

> E-postadaki sayı, bot hesabının kullanıcı id'sidir (`343685009`).
> GitHub commit yazarını bu biçimdeki e-postadan tanır
> (`<bot-id>+<bot-login>@users.noreply.github.com`). Başka bir hesabın id'si
> yazılırsa commit tanınmaz: katkıcı listesinde görünmez ve avatar boş kalır.
> `src/test/gitidentity.test.ts` bu numarayı canlı olarak doğrular.

Farklı bir kimlikle commit atmak istiyorsanız (ör. kendi kişisel çalışmanız):

```bash
git -c user.name="Adınız" -c user.email="e-posta@adresiniz" commit -m "mesaj"
```

Commit'lerin GitHub'da **doğrulanmış (Verified)** görünmesi için ek olarak
bot anahtarıyla imzalama (commit signing) gerekir; sadece isim/e-posta
eşleşmesi doğrulama rozeti vermez. İmzalama aktifleştirildiğinde bu depodaki
Tulvez Code commit'leri diğer katkıcılardan ayırt edilebilir görünür.

## Kullanıcılar için git kimliği

Tulvez Code, kullandığı depoda commit attığında bot kimliğini **kullanıcıdan
bir kez onay alıp** uygular (ayar: `tulvez.gitIdentity`, varsayılan açık):

- Sadece o klasörün `.git/config` dosyasına yazılır, **global ayarlara dokunulmaz**
- Kimlik zaten bot ise hiçbir şey yapılmaz
- Vazgeçilirse bir daha sorulmaz
- Kapatmak için: `tulvez.gitIdentity: false`
