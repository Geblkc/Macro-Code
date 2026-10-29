<div align="center">
  <img src="public/macrocode-logo.svg" width="110" alt="MacroCode logo" />
  <h1>MacroCode</h1>
  <p><strong>Ein KI-Terminal unter deiner Kontrolle — Bring Your Own Key, deine Daten bleiben bei dir.</strong></p>
  <p>
    <a href="https://github.com/Geblkc/Macro-Code/releases"><img src="https://img.shields.io/github/v/release/Geblkc/Macro-Code?label=release&color=0a7ea4" alt="Release" /></a>
    <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-0a7ea4" alt="Plattform" />
    <img src="https://img.shields.io/badge/Tauri-v2-24c8db" alt="Tauri v2" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--2.0--only-blue.svg" alt="Lizenz: GPL-2.0-only" /></a>
  </p>
  <p><a href="README.md">English</a> · <a href="README.tr.md">Türkçe</a> · <strong>Deutsch</strong> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>
</div>

<img width="1920" height="1006" alt="MacroCode Screenshot" src="https://github.com/user-attachments/assets/f67a19a7-9f72-458f-8236-75bbd31c18cd" />

## Was ist MacroCode?

MacroCode ist eine quelloffene, plattformübergreifende Desktop-Anwendung, mit der du in
einer **terminalähnlichen Oberfläche — mit deinen eigenen API-Schlüsseln** (BYOK) mit
KI-Modellen chatten und arbeiten kannst. Gebaut mit Tauri v2 + React + TypeScript,
als eine kleine native Binärdatei vertrieben — gedacht für Entwickler, die Text,
Befehle und tastaturzentrierte Werkzeuge schätzen.

Kein Server, kein Konto, keine Telemetrie: Deine Unterhaltungen liegen in einer lokalen
SQLite-Datenbank, und deine Schlüssel verlassen das Gerät nur als Authentifizierungs-
Header, die direkt an den von dir konfigurierten Anbieter gehen.

## Was kann es?

| | |
|---|---|
| 🧠 **7 Anbieter** | Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, DeepSeek und xAI. Jeder Anbieter erscheint erst in den Listen, wenn sein Schlüssel (bei Ollama: eine lokale URL) hinterlegt ist. |
| 🔮 **Hunderte Modelle** | Der kleine kuratierte Katalog wird mit Metadaten von [models.dev](https://models.dev) angereichert: Kontextlimits, Vision-/Reasoning-Fähigkeiten und Preise. |
| ⌨️ **Terminal-Bedienung** | Slash-Befehle (`/model`, `/tokens`, `/compact`, `/help` …), Nachrichtenverlauf mit `↑ ↓`, sofortige Token-Messung pro Runde. |
| 🤖 **Agent-Modus** | Weise mit `/root` einen Projektordner zu: Er kann Dateien lesen, im Code suchen, Dateien bearbeiten und Shell-Befehle ausführen. Jede Schreib- oder Ausführungsaktion läuft über eine Freigabekarte, die du bestätigen oder ablehnen kannst; `rm` ist eingeschränkt und Systemordner sind blockiert. Zusätzlich verbindet er sich mit MCP-Servern (stdio oder HTTP) für weitere Werkzeuge. |
| 💸 **Kosten im Blick** | Prompt-Caching (Anthropic-Cache-Breakpoints / OpenAI-kompatible Cache-Keys) hält lange Sessions günstig; `/tokens` zeigt exakt, was jede Runde gekostet hat — Cache-Lesevorgänge eingeschlossen. |
| 🌍 **5 Sprachen** | Die Oberfläche ist vollständig übersetzt: English, Deutsch, Español, Français und Türkçe; ein Wechsel wirkt sofort, kein Neustart nötig. |
| 🔒 **Deine Daten gehören dir** | Sessions leben in SQLite mit JSON-Import/Export; alles ist portabel und bei Bedarf offline nutzbar. |

## Installation

Lade ein Paket für deine Plattform von der
[Releases-Seite](https://github.com/Geblkc/Macro-Code/releases) herunter
(Linux `.deb` / `.AppImage`, Windows `.msi` / `.exe`, macOS `.dmg`).

Oder aus dem Quellcode bauen:

```bash
npm install
npm run tauri dev    # vollständige Desktop-App (Rust + Tauri-Abhängigkeiten nötig)
npm test             # Unit-Tests
```

Produktionspakete:

```bash
npm run dist:linux   # .deb / .rpm / AppImage
npm run build        # nur Typprüfung + Web-Build
```

## Erster Start

1. **Einstellungen** öffnen (oder `/key` eingeben).
2. Den API-Schlüssel deines Anbieters einfügen und speichern. Für
   [Ollama](https://ollama.com) genügt eine lokale URL wie `http://localhost:11434`.
3. Nachricht tippen — oder `/help` für alle Befehle.

## Dokumentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Projektaufbau, Modul für Modul
- [`docs/MODELS.md`](docs/MODELS.md) — Modellkatalog und die Verschmelzung mit models.dev
- [`docs/PACKAGING.md`](docs/PACKAGING.md) — `.deb` / `.rpm` / AppImage lokal bauen, Windows-Installer per CI
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — datiertes Protokoll jeder Änderung
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Richtlinien für Pull-Requests

## Mitwirken

Beiträge sind willkommen — Fehlerberichte, Übersetzungen und Pull-Requests gleichermaßen.
Den Ablauf beschreibt [`CONTRIBUTING.md`](CONTRIBUTING.md); bitte eröffne vor größeren
Änderungen ein Issue.

## Lizenz

MacroCode steht unter der **GNU General Public License, Version 2, ausschließlich**
(`GPL-2.0-only`) — vollständiger Text in [`LICENSE`](LICENSE).

```
Copyright (C) 2026 Gökhan Efe Balıkçı
```
