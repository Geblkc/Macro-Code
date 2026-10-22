<div align="center">

<img src="public/macrocode-logo.svg" width="110" alt="MacroCode logo" />

# MacroCode

**An AI terminal you control — bring your own key, keep your own data.**

[![CI](https://github.com/Geblkc/Macro-Code/actions/workflows/ci.yml/badge.svg)](https://github.com/Geblkc/Macro-Code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/release-v0.1.0-orange)](#-install)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

*Built with Tauri v2 · React 18 · TypeScript · Zustand — a single small binary, no Electron, no server, no telemetry.*

</div>

---

## Why MacroCode?

Chatting with AI shouldn't mean handing your keys and your conversation history to a website.
MacroCode runs **your** API calls from a native desktop app with a terminal mindset:
everything is text, commands, and keyboard-driven — and all state stays in a local SQLite file.

```
❯ bring me up to speed on this repo
- 245 files · key: src-tauri/src/lib.rs, src/App.tsx, docs/ARCHITECTURE.md
- context: 3.2k tokens (auto-read, budget 200k)

✓ proposal: patch @ src/lib/engine/policy.ts   [apply] [skip]
```

| | |
|---|---|
| 🔑 **BYOK, 7 providers** | Anthropic, OpenAI, Gemini, Ollama, OpenRouter, DeepSeek, xAI — no subscription, no proxy of your key |
| 🤖 **Agent mode** | Point it at a workspace (`/root`) and it reads, searches, edits and runs commands — **with granular approvals** |
| 💰 **Prompt caching** | Anthropic cache breakpoints + OpenAI-compatible `prompt_cache_key`; cache tokens priced separately |
| 📚 **~500 models** | Hand-curated core catalog merged with [models.dev](https://models.dev) metadata (limits, vision, reasoning, pricing) |
| 🛡 **Safety-first agent** | `exec` always requires approval, blocked paths (`.git`, `node_modules`), `rm` restricted to `-i` |
| 🌍 **5 UI languages** | English · Türkçe · Deutsch · Français · Español, switchable at runtime |
| 🧘 **Local-first** | SQLite sessions, JSON import/export, work offline; nothing leaves your machine but the API call itself |
| ✨ **Terminal aesthetic** | Rich markdown, syntax highlighting, token metering per message, mouse-free operation |

## Install

Grab the latest package for your OS from [Releases](https://github.com/Geblkc/Macro-Code/releases):

| Platform | Artifact |
|---|---|
| Linux | `.deb` / `.AppImage` |
| Windows | `.msi` / `.exe` |
| macOS | `.dmg` |

### Build from source

```bash
git clone https://github.com/Geblkc/Macro-Code
cd macro-code && npm install

npm run tauri dev   # full desktop build (Rust +WebView)
npm run dev         # frontend-only, in a browser (Tauri APIs shimmed)
npm test            # vitest — 65 files / 495 tests
```

**Requirements:** Node 22 · Rust stable · [Tauri system dependencies](https://tauri.app/start/prerequisites/)
(Linux: `libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`).

## First run

1. Open **Settings** (or type `/key` in the terminal).
2. Paste the API key for your provider and hit **Save**.
   Ollama is special — a local URL (`http://localhost:11434`) is enough, no key needed.
3. The status bar turns green (`connected`) — you're ready. Type away or explore `/help`.

> **Why can't I see any models?** Providers only appear once their key is set:
> the model lists, `/model`, and the title-bar picker all hide key-less providers —
> each shows a "🔑 add key" row that jumps straight to settings.

### Where does your data live?

| Data | Location |
|---|---|
| API keys | `app_data_dir/keys.json` (plain text — `tauri-plugin-store` does **not** encrypt) |
| Sessions | `sessions.db` (SQLite), with a localStorage fallback for browser-only dev |
| Settings / workspace | `macrocode-settings`, `macrocode-workspace` (localStorage) |

Your keys never leave the machine except as `Authorization` headers to the provider you configured. Runtime sandboxing: a strict CSP allows requests only to the 6 API hosts and localhost.

## Agent mode

Point MacroCode at any folder and it earns its keep:

```
/root ~/projects/api-server     # choose the workspace
/files                          # quick file summary
/context                        # what the agent knows
/approval auto-edit             # hands-off editing (manual is the default)
/approve 3f2a1b0c               # ...or approve a specific patch by id
/undo                           # revert the last applied patch
/audit 20                       # inspection trail
```

Tools available to the agent: `read_file`, `list_dir`, `grep`, `glob`,
`edit_file`, `write_file`, `propose_patch`, `exec`, `todo`, `plan`,
a read-only `subagent`, **plus any stdio or HTTP MCP server you register in settings**.

Approval modes: `manual` (default — every write asks) · `auto-read` · `auto-edit` (writes still logged, `exec` still askable).

## Commands

`/help` prints the live list. Some favorites:

| Command | What it does |
|---|---|
| `/model [id]` | switch model (title-bar picker and settings stay in sync) |
| `/compact` | summarize & shrink the conversation when it's near the context budget |
| `/tokens` | token usage per turn, incl. cache read/write pricing |
| `/system <text>` | set a custom system prompt |
| `/note <text>` | persist a project note the agent reads next session |
| `/export [md\|json]` | download the session as Markdown/JSON (`/backup` = JSON) |
| `/audit`, `/log` | approval trail and runtime logs |

## Multilingual

The UI ships in **English · Türkçe · Deutsch · Français · Español**.
Language can follow the OS or be pinned in *Settings → Appearance & language*, changes apply live without a restart.
(Tool descriptions sent to models stay English — performance over aesthetics.)

## Documentation

- **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** — the living map of every module (always current).
- **[`docs/MODELS.md`](docs/MODELS.md)** — the built-in model catalog + models.dev enrichment rules.
- **[`docs/DEVLOG.md`](docs/DEVLOG.md)** — dated, verified change log of every phase.

## Contributing

Issues and PRs are welcome! Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first —
it covers test expectations, allowlist-drift rules, and the "faz closure" discipline that keeps this codebase coherent.

## Roadmap

- [ ] In-app auto-update (Tauri updater + GitHub Releases)
- [ ] Provider-by-provider usage dashboards
- [ ] Streaming tool-calls (partial [`tool_use`] rendering)
- [ ] Theme editor

## License

MIT — see [`LICENSE`](LICENSE).

Model metadata courtesy of [models.dev](https://models.dev), icons hand-drawn SVG, fonts bundled as system stacks.
