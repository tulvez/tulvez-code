# Tulvez Code

Tulvez Code, VS Code için gizlilik odaklı, BYOK (kendi anahtarını getir) mimarisine sahip yapay zeka kodlama asistanıdır.

## Özellikler

- **Ask / Plan / Build** modları: sadece soru cevaplama, plan üretme ve aktif kod yazma
- **Çoklu sağlayıcı**: OpenAI, Anthropic, Google Gemini, Groq, Ollama (yerel)
- **Araç döngüsü**: `read_file`, `write_file`, `edit_file`, `list_files`, `run_command` ile gerçek kod değişikliği ve terminal çalıştırma
- **Onay mekanizması**: dosya yazma/düzenleme otomatik, `run_command` onay ister (Ayarlar üzerinden değiştirilebilir)
- **Git kısayolları**: `/commit`, `/review`, `/diff`, `/explain`, `/run`
- **Markdown render**, thinking animasyonu, token/maliyet/bağlam istatistikleri
- **Kota bilgisi**: sağlayıcının model bazlı limit verileri ve sıfırlanma zamanı
- **BYOK + SecretStorage**: API anahtarın yalnızca VS Code'un şifreli saklayıcısında durur; Tulvez sunucusuna gönderilmez

## Kurulum

Marketplace yayınından sonra:

1. VS Code → Eklentiler → "Tulvez Code" ara → Yükle
2. Sol kenardaki Tulvez Code ikonuna tıkla
3. API anahtarını Ayarlar sekmesinden veya boş ekrandaki karttan ekle
4. Sağlayıcı ve modeli seç; listede sadece hesabındaki gerçek modeller görünür

## Kullanım

- Sohbetten kod yazdırma: Build modu → "main.py oluştur, içine print yaz"
- Git: `/commit` ile değişikliklerden commit mesajı, `/review` ile kod incelemesi, `/diff` ile özet
- `/explain`: editörde seçili kodu açıklar

## Geliştirme

```bash
npm install
npm run check   # tip kontrolü
npm run build   # extension + webview bundle
npm run watch:extension  # veya watch:webview
```

VS Code içinde `F5` ile Extension Development Host açılır.

## Paketleme / yayınlama

```bash
npx @vscode/vsce package          # VSIX üret
npx @vscode/vsce publish -p $VSCE_PAT   # Marketplace'e gönder
```

`v*` etiketi (tag) atınca GitHub Actions otomatik derleyip Marketplace'e yayınlar. Detaylar `.github/workflows/publish.yml` dosyasında. `VSCE_PAT` adlı bir repository secret'ı gereklidir (Marketplace bir Azure DevOps Personal Access Token ister).

## Gizlilik

- API anahtarları VS Code `SecretStorage`'da saklanır.
- Kod, istek sırasında seçilen sağlayıcının API'sine gider; Tulvez'ın kendi sunucusu yoktur.
- `sendCodeContext` kapalıysa aktif dosya içeriği otomatik eklenmez.

## Lisans

MIT — [LICENSE](LICENSE)
