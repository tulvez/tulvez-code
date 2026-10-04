# Cline Spike Sonucu

**Tarih:** 2026-10-04
**Soru:** VS Code eklentimize Cline'ın ajan çekirdeğini (`@cline/agents`) kullanabilir miyiz?

## Kurulum

```bash
npm install @cline/agents @cline/llms @cline/shared
```

Paketler `0.0.90` sürümünde, dış bağımlılıkları (Langfuse, OpenTelemetry, node-machine-id,
PostHog peer dep) nedeniyle VSIX'i büyütüyor.

## Doğrulananlar

| Yetenek | Durum | Not |
|---|---|---|
| VS Code'dan bağımsız ajan döngüsü | ✅ | `createAgent` çalıştı, `run()` döndü |
| Kendi araçlarımızı bağlama | ✅ | `createTool({ name, description, inputSchema: zod, execute })` — `executeTool` sarmalandı, sorun yok |
| Provider katmanımızı koruma | ✅ | `providerId` + `modelId` + `apiKey` + `baseUrl` doğrudan veriliyor; bizim `resolveModel` mantığımızı kullanmaya devam edebiliriz |
| Streaming metin | ✅ | `assistant-text-delta` event'i (accumulatedText ile) |
| Reasoning / düşünüş | ✅ | `assistant-reasoning-delta` event'i |
| Araç çağrısı takibi | ✅ | `tool-call`, `tool-call-delta`, `tool-result` event'leri |
| İptal (durdur butonu) | ✅ | `AgentRuntime.abort(reason)` + `AgentRuntimeAbortError` |
| Hata yönetimi | ✅ | `run-failed` event'i; `run-failed` yerine error ayrıntısını koruyoruz |

## Canlı doğrulama yapılamadı

Gemini ücretsiz kotası bugün doldu (20 istek/gün), Ollama kurulu değil. Bu yüzden
`run()` gerçek bir provider'a gidip cevap alamadı — mimari çalıştı, uçtan uca
model cevabı doğrulanamadı. Bu, kararın önündeki tek açık soru işaretidir.

## Riskler

1. **`0.0.x` sürüm**: API stabil değil, yükseltmede kırılır. Exact pin'lemek zorundayız.
2. **Bağımlılık şişmesi**: `@cline/llms` 10.8 MB / 29 bağımlılık. VSIX boyutu ve
   extension host belleği etkilenir. Kullanmadığımız provider'ları (Langfuse, PostHog,
   cloud connector) tree-shaking ile atmak gerekebilir.
3. **Kendi VS Code host katmanımız yok**: `apps/vscode` yayınlanmıyor; `RuntimeHost`
   implementasyonunu (LocalRuntimeHost) biz yazacağız. ~200-300 satır.
4. **Lisans metadata**: `@cline/shared` ve `@cline/core` package.json'da `license`
   alanı yok. Repo LICENSE temiz Apache-2.0 ama npm metadata'sı eksik — yayın
   öncesi doğrulanmalı.

## Karar önerisi

Spike **olumlu**: Cline'ın event modeli bizim webview akışımıza birebir uyuyor ve
kendi araçlarımızı değiştirmeden bağlıyoruz. Ancak üç şey tamamlanmadan kalıcı
bağımlılık yapmıyorum:

1. Gerçek bir provider ile uçtan uca test (Ollama ile, kurulumu 5 dakika)
2. VSIX boyutu ölçümü ve gereksiz bağımlılıkların atılması
3. `LocalRuntimeHost` yazımı + `run-failed` hata detayının korunması

Bu üçü yapılırsa geçiş 3-4 gün. Yapılmazsa mevcut döngümüz çalışmaya devam eder.
