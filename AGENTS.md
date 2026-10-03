# Tulvez Code — Ajan (Agent) Bağlam Dosyası

Bu dosya, Tulvez Code'un bu depoyu kendi araçlarıyla çalışması için gereken bağlamı içerir. Tulvez Code `read_file` / `list_files` araçlarıyla bu dosyayı okuyarak proje kurallarını öğrenir.

## Komutlar

```bash
npm run check            # hem extension hem webview için TypeScript kontrolü
npm run build            # extension (esbuild) + webview (vite) derlemesi
npm run watch:extension  # extension izleme
npm run watch:webview    # webview izleme
npx @vscode/vsce package # VSIX üret
```

## Mimari

- `src/extension.ts` — aktivasyon, komutlar, mesaj köprüsü, SecretStorage ayarları, AI satır işaretleme
- `src/services/agent.ts` — sağlayıcıdan bağımsız tool-calling döngüsü (OpenAI uyumlu, Anthropic, Gemini) + retry
- `src/services/ai.ts` — streaming sohbet (metin), maliyet tablosu, rol promptları
- `src/services/tools.ts` — araç tanımları ve çalıştırıcılar; AI satır işaretleme dekorasyonları
- `src/services/messages.ts` — host ↔ webview mesaj tipleri (tek kaynak)
- `webview/src/App.tsx` — React arayüz; extension mantığı içermez
- `webview/src/components/SettingsPage.tsx` — ayarlar, model listesi, kota bilgisi

## Kurallar

- Sağlayıcıya özel mantık `agent.ts` içinde, tek bir noktada toplanır; webview'da provider bilgisi tutulmaz
- API anahtarları sadece VS Code SecretStorage'da tutulur, hiçbir dosyaya yazılmaz
- Commit mesajı: Türkçe, küçük harf, `[kapsam]:` öneki (örn. `[ai]: gemini retry eklendi`)
- Tip güvenliği: `strict` varsayılan; `npm run check` temiz geçmeden commit atılmaz
- Yeni bağımlılık eklemeden önce mevcut paketlerle çözülüp çözülemediğini kontrol et