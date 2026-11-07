# MacroCode v0.2.3 — Release Notes

**Date:** November 7, 2026  
**Previous Version:** v0.2.2

---

## 🎯 Overview

v0.2.3 focuses on **long-running command reliability**, **context management** and **usage visibility**. Shell commands now stream live output, use type-aware timeouts and can be cancelled — including their entire process tree. The context meter is now based on the last real API request, compaction has a predictable threshold, and a new Statistics screen tracks cost, tokens, sessions and cache savings.

---

## ✨ New Features

### ⚡ Live command streaming, timeout and cancellation
- `exec_cmd_stream` + Tauri `Channel<ExecEvent>`: stdout/stderr stream live; the tool card opens automatically while running.
- Type-aware timeouts: normal **30 s**, test/check/lint **120 s**, build/install **300 s**.
- Per-call `timeoutMs` and a **1–600 s** global upper bound in Settings > Chat (default 300 s).
- A **stop** button on the running `exec` card; cancellation via `exec_cancel`.
- Cancellation/timeout now terminates the **entire process tree**:
  - Unix: separate process group + `SIGKILL` (safe PGID check).
  - Windows: Job Object + `KILL_ON_JOB_CLOSE`, `TerminateJobObject`; `taskkill /T /F` fallback.
- Non-zero exit codes, cancellation and timeout are now reported as `tool_result ok:false`; the agent can run a correction turn.
- The existing `exec_cmd` / `ExecOut` contract remains backward compatible; the legacy command path also cleans up the process tree.

### 🧠 Context and compaction
- The compaction threshold is derived from window usage; 16k tokens are reserved for the response.
- The status bar context meter uses the **last API request's** real usage (`lastRequest`); session totals are shown separately.
- The auto-compaction percentage (e.g. “auto-compact at 75%”) is visible in the meter.
- `/compact` and automatic compaction use the same limit.

### 🛡️ Provider resilience
- The `Retry-After` header (seconds or HTTP date) is used instead of exponential backoff.
- A visible countdown before retry: “⟳ attempt 2/3 · 4 s”.
- If partial text/tool calls were already streamed, the same request is not retried (`shouldRetry`).

### 📊 Usage statistics
- New **Statistics** screen: total cost, tokens, sessions, requests, cache savings and average per session.
- Time series (cost/tokens/requests) and per-model breakdown.
- 7/30/90-day, project, model and provider filters.
- Every API step is recorded in the `usage_events` table (cost from the price table; marked as estimated when no price is available).

### 🎨 UI and UX
- Session rename: **F2** shortcut, Enter/Esc and an empty-name warning.
- Session model and mode badge in the sidebar (build/plan/ask).
- Speed/cost hints and a `max` value in the effort selector.
- Group headings are emphasized in `/help` output.

---

## 🔒 Security

- Workspace jail, allowlist, dangerous flags (`-exec`, `--pre`), secret/blocked-file checks and the approval/audit flow are unchanged.
- Process-tree termination only applies to the child started by the caller; on Unix, the group is not signaled unless the PGID is verified.

---

## 🧪 Testing & Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ |
| `npm test` | 698 passed / 0 failed |
| `npm run build` | ✅ |
| `cargo test --lib` | 97 passed / 0 failed |
| `cargo clippy --all-targets --all-features -- -D warnings` | ✅ |
| `cargo fmt --check` | ✅ |
| Windows `proc_tree.rs` build check (`x86_64-pc-windows-gnu`) | ✅ |

---

## 📦 Distribution Packages

| Platform / Format | File |
| :--- | :--- |
| 🐧 Linux (AppImage) | `MacroCode_0.2.3_amd64.AppImage` |
| 🐧 Debian / Ubuntu (.deb) | `MacroCode_0.2.3_amd64.deb` |
| 🐧 Fedora / RHEL (.rpm) | `MacroCode-0.2.3-1.x86_64.rpm` |
| 🪟 Windows (NSIS) | `MacroCode_0.2.3_x64-setup.exe` |
| 🪟 Windows (MSI) | `MacroCode_0.2.3_x64_en-US.msi` |

> Packages are built and attached via the GitHub Actions release workflow.

---

## 📝 Notes

- On Windows, because of `KILL_ON_JOB_CLOSE`, descendant processes left inside the job are cleaned up even if the command exits normally. On Unix, descendants are not touched on normal exit; the group is killed only on cancellation/timeout/error.
- Since v0.2.2 was the first updater release, v0.2.2 and later can update automatically.
- `Security.md` was not modified.
- `auto-edit` mode writes without approval; blocked directories remain closed.

---

**MacroCode v0.2.3** — Live shell streaming, process-tree cancellation, reliable context and usage statistics.
