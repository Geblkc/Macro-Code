<div align="center">
  <img src="public/macrocode-logo.svg" width="110" alt="MacroCode logo" />
  <h1>MacroCode</h1>
  <p><strong>An AI terminal you control — bring your own key, keep your own data.</strong></p>
  <p><strong>English</strong> · <a href="README.tr.md">Türkçe</a> · <a href="README.de.md">Deutsch</a> · <a href="README.fr.md">Français</a> · <a href="README.ru.md">Русский</a></p>
</div>

<img width="1920" height="1006" alt="Ekran Görüntüsü_20261024_214103" src="https://github.com/user-attachments/assets/f67a19a7-9f72-458f-8236-75bbd31c18cd" />


## What is MacroCode?

MacroCode is an open source, cross-platform desktop app that lets you chat and work with AI
models from a **terminal-style interface — using your own API keys** (BYOK).
It is built with Tauri v2 + React + TypeScript, ships as a single small native binary,
and is designed for developers who like text, commands and keyboard-first tools.

There is no server, no account and no telemetry: your conversations are stored in a
local SQLite database, and your keys never leave your machine except as
authentication headers sent directly to the provider you configured.

## What can it do?

- **Talk with 7 providers** — Anthropic, OpenAI, Google Gemini, Ollama, OpenRouter, DeepSeek and xAI.
  Each provider only appears in the lists once its key (or, for Ollama, a local URL) is set.
- **Choose from hundreds of models** — a small hand-curated catalog is enriched with
  [models.dev](https://models.dev) metadata: context limits, vision/reasoning capabilities and pricing.
- **Use it like a terminal** — slash commands (`/model`, `/tokens`, `/compact`, `/help`…),
  message history with `↑ ↓`, instant token metering for every turn.
- **Let it work as an agent** — point it at a project folder with `/root` and it can read files,
  search the codebase, edit files and run shell commands. Every write/execution goes through an
  approval card you can accept or reject; `rm` is restricted and system folders are blocked.
  It also connects to MCP servers (stdio or HTTP) for extra tools.
- **Control cost** — prompt caching (Anthropic cache breakpoints / OpenAI-compatible cache keys)
  keeps long sessions cheap, and `/tokens` shows exactly what each turn cost, including cache reads.
- **Work in your language** — the UI is fully translated to
  English, Türkçe, Deutsch, Français and Español; switching applies instantly, no restart.
- **Own your data** — sessions live in SQLite with JSON export/import, so everything is portable
  and works offline when you need it to.
```

## First run

1. Open **Settings** (or type `/key`).
2. Paste an API key for your provider and save. For [Ollama](https://ollama.com),
   a local URL like `http://localhost:11434` is enough.
3. Type a message — or `/help` to see all commands.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the project is structured, module by module
- [`docs/MODELS.md`](docs/MODELS.md) — the model catalog and how it merges with models.dev
- [`docs/DEVLOG.md`](docs/DEVLOG.md) — dated record of every change
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — guidelines for pull requests

## License

MIT — see [`LICENSE`](LICENSE).
