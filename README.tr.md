<div align="center">
  <img src="public/macrocode-logo.svg" width="110" alt="MacroCode logo" />
  <h1>MacroCode</h1>
  <p><strong>Kontrol sende olan bir AI terminali — kendi anahtarını getir, verilerin sende kalsın.</strong></p>
  <p>
    <a href="https://github.com/Geblkc/Macro-Code/releases"><img src="https://img.shields.io/github/v/release/Geblkc/Macro-Code?label=release&color=0a7ea4" alt="Sürüm" /></a>
    <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-0a7ea4" alt="Platform" />
    <img src="https://img.shields.io/badge/Tauri-v2-24c8db" alt="Tauri v2" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--only-blue.svg" alt="Lisans: GPL-2.0-only" /></a>
  </p>
  <p><a href="README.md">English</a> · <strong>Türkçe</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>
</div>

<img width="1920" height="1006" alt="MacroCode ekran görüntüsü" src="https://github.com/user-attachments/assets/f67a19a7-9f72-458f-8236-75bbd31c18cd" />

## MacroCode nedir?

MacroCode, AI modelleriyle **terminal benzeri bir arayüzde — kendi API anahtarlarını
kullanarak** (BYOK) konuşup çalışabileceğin açık kaynaklı, çapraz platform bir masaüstü
uygulamasıdır. Tauri v2 + React + TypeScript ile yazılmıştır; tek küçük doğal ikili
(binary) olarak dağıtılır ve metne, komuta ve klavye odaklı araçlara değer veren
geliştiriciler için tasarlanmıştır.

Sunucu, hesap ve telemetri yoktur: sohbetlerin yerel bir SQLite veritabanında saklanır
ve anahtarların makinenizden yalnızca, yapılandırdığınız sağlayıcıya doğrudan gönderilen
kimlik doğrulama başlıkları olarak çıkar.

## Neler yapabilir?

| | |
|---|---|
| 🧠 **7 sağlayıcı** | Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, DeepSeek ve xAI. Her sağlayıcı, anahtarı (Ollama için yerel URL) girilene kadar listelerde görünmez. |
| 🔮 **Yüzlerce model** | Elle hazırlanmış küçük katalog, [models.dev](https://models.dev) metadata'sıyla zenginleşir: bağlam limitleri, görsel/düşünme yetenekleri ve fiyatlandırma. |
| ⌨️ **Terminal deneyimi** | Slash komutları (`/model`, `/tokens`, `/compact`, `/help`…), `↑ ↓` ile mesaj geçmişi, her turda anlık token ölçümü. |
| 🤖 **Ajan modu** | `/root` ile bir proje klasörünü gösterin; dosya okuyabilir, kodda arama yapabilir, dosya düzenleyebilir ve shell komutu çalıştırabilir. Her yazma/çalıştırma, kabul edebileceğin veya reddedebileceğin bir onay kartından geçer; `rm` kısıtlıdır ve sistem klasörleri engellidir. Ek araçlar için stdio veya HTTP MCP sunucularına da bağlanır. |
| 💸 **Maliyet kontrolü** | Prompt önbellekleme (Anthropic cache breakpoint'leri / OpenAI uyumlu cache anahtarları) uzun oturumları ucuz tutar; `/tokens` her turun tam maliyetini, önbellek okumaları dahil gösterir. |
| 🌍 **5 dil** | Arayüzün 5 tam çevirisi var: English, Türkçe, Deutsch, Français ve Español; geçiş anında uygulanır, yeniden başlatma gerekmez. |
| 🔒 **Verin sende kalsın** | Oturumlar JSON içe/dışa aktarmayla SQLite'ta yaşar; her şey taşınabilirdir ve gerektiğinde çevrimdışı çalışır. |

## Kurulum

Platformuna uygun paketi [Releases](https://github.com/Geblkc/Macro-Code/releases)
sayfasından indir (Linux `.deb` / `.AppImage`, Windows `.msi` / `.exe`, macOS `.dmg`).

Ya da kaynaktan derle:

```bash
npm install
npm run tauri dev    # tam masaüstü uygulaması (Rust + Tauri bağımlılıkları gerekir)
npm test             # birim testler
```

Üretim paketleri:

```bash
npm run dist:linux   # .deb / .rpm / AppImage
npm run build        # yalnızca tip kontrolü + web derlemesi
```

## İlk çalıştırma

1. **Ayarlar**'ı aç (veya terminale `/key` yaz).
2. Sağlayıcının API anahtarını yapıştırıp kaydet. [Ollama](https://ollama.com) için
   `http://localhost:11434` gibi bir yerel URL yeterlidir.
3. Mesajını yaz — ya da tüm komutları görmek için `/help` yaz.

## Dokümantasyon

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — projenin yapısı, modül modül
- [`docs/MODELS.md`](docs/MODELS.md) — model kataloğu ve models.dev ile birleşim kuralları
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — `.deb` / `.rpm` / AppImage yerel derleme + Windows kurulumu (CI)
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — her değişikliğin tarihli kaydı
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — katkı kuralları

## Katkı

Hata raporları, çeviriler ve pull request'ler her zaman beklenir. Akış için
[`CONTRIBUTING.md`](CONTRIBUTING.md) dosyasına bak; büyük değişikliklerden önce
açık bir issue açmanı öneririz.

## Lisans

MacroCode, **GNU Genel Kamu Lisansı v2.0 yalnızca** (`GPL-2.0-only`) altındadır —
tam metin için [`LICENSE`](LICENSE) dosyasına bak.

```
Copyright (C) 2026 Gökhan Efe Balıkçı
```
