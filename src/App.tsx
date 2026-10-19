import { useCallback, useEffect, useRef, useState } from 'react';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import InputBar from './components/InputBar';
import SettingsModal from './components/SettingsModal';
import { useStream } from './hooks/useStream';
import { getActiveAgentRun, useAgent } from './hooks/useAgent';
import { useWorkspaceStore } from './store/workspace';
import { listSkills } from './lib/engine/skills';
import { applyPendingPatch, listPending, undoLastPatch } from './lib/engine/tools/patch';
import { listApprovals, restoreApprovals, takeApproval } from './lib/engine/approvals';
import type { PendingApproval } from './lib/engine/approvals';
import type { ApprovalMode, ToolCall } from './lib/engine/types';
import { summarizeWorkspace } from './lib/engine/context';
import { budgetFor } from './lib/engine/tokens';
import { clearMemo } from './lib/engine/compactionMemo';
import { appendMemory, buildRepoContext, clearRepoContextCache } from './lib/engine/repoContext';
import { recentLogs } from './lib/logger';
import { compactSessionMessages, shouldCompact } from './lib/engine/compact';
import { makeSummarizeFn, summarizerConfig } from './lib/summarize';
import { buildSessionBackup, handleSlashCommand, parseSessionBackup, type CommandContext } from './lib/commands';
import { createSessionPersister, loadSessionsFromDb, readAuditLog, saveSessionsToDb, sqlError } from './lib/db';
import type { ExtraLine, Provider, TerminalLine } from './types';
import { createId, useSessionStore } from './store/session';
import { DEFAULT_MODELS, useSettingsStore } from './store/settings';
import { ALL_MODELS, PROVIDER_IDS, getCapabilitiesForModel, hasProviderKey } from './lib/providers';
import { isStale } from './lib/providers/modelsDev';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function detectPlatform(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return nav.userAgentData?.platform ?? navigator.platform ?? 'unknown';
}

function detectArch(): string {
  const ua = navigator.userAgent;
  if (/aarch64|arm64/i.test(ua)) return 'arm64';
  if (/x86_64|win64|x64|amd64/i.test(ua)) return 'x64';
  return 'unknown';
}

function downloadFile(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function stampedFilename(prefix: string, ext: string): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}-${stamp}.${ext}`;
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [extrasBySession, setExtrasBySession] = useState<Record<string, ExtraLine[]>>({});
  const [clearedBefore, setClearedBefore] = useState<Record<string, number>>({});
  const [pendingBySession, setPendingBySession] = useState<Record<string, PendingApproval[]>>({});
  const bootedRef = useRef(false);
  // Faz 7: önceki oturum id'leri (silinen oturumların compaction hafızası için).
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  const { send, abort: abortStream } = useStream();
  const { sendAgent, resolvePending, restorePendingRuns, abort: abortAgent } = useAgent();
  const abort = () => {
    abortStream();
    abortAgent();
  };

  const activeId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const streaming = useSessionStore((s) => s.isStreaming);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const session = sessions.find((s) => s.id === activeId) ?? null;

  const MAX_EXTRAS_PER_SESSION = 200;

  const pushExtra = useCallback((sessionId: string, line: Omit<TerminalLine, 'id'>) => {
    const full: ExtraLine = { ...line, id: createId(), ts: Date.now() };
    setExtrasBySession((prev) => {
      const next = [...(prev[sessionId] ?? []), full];
      const capped = next.length > MAX_EXTRAS_PER_SESSION ? next.slice(next.length - MAX_EXTRAS_PER_SESSION) : next;
      return { ...prev, [sessionId]: capped };
    });
  }, []);

  const clearView = useCallback((sessionId: string) => {
    setExtrasBySession((prev) => ({ ...prev, [sessionId]: [] }));
    setClearedBefore((prev) => ({ ...prev, [sessionId]: Date.now() }));
  }, []);

  const setPending = useCallback((sessionId: string, pending: PendingApproval[]) => {
    setPendingBySession((prev) => ({ ...prev, [sessionId]: pending }));
  }, []);

  const handleApproveAll = useCallback(
    async (sessionId: string) => {
      const pend = pendingBySession[sessionId] ?? [];
      if (pend.length === 0) return;
      const decisions = pend.map((p) => ({ id: p.id, approved: true }));
      setPending(sessionId, []);
      const err = await resolvePending(
        sessionId,
        decisions,
        (line) => pushExtra(sessionId, line),
        (next: ToolCall[]) =>
          setPending(
            sessionId,
            next.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
          ),
      );
      if (err) pushExtra(sessionId, { type: 'err', content: err });
    },
    [pendingBySession, resolvePending, pushExtra, setPending],
  );

  const handleRejectAll = useCallback(
    async (sessionId: string) => {
      const pend = pendingBySession[sessionId] ?? [];
      if (pend.length === 0) return;
      const decisions = pend.map((p) => ({ id: p.id, approved: false }));
      setPending(sessionId, []);
      const err = await resolvePending(
        sessionId,
        decisions,
        (line) => pushExtra(sessionId, line),
        (next: ToolCall[]) =>
          setPending(
            sessionId,
            next.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
          ),
      );
      if (err) pushExtra(sessionId, { type: 'err', content: err });
    },
    [pendingBySession, resolvePending, pushExtra, setPending],
  );

  const handleSend = useCallback(
    async (text: string, images: string[] = []) => {
      const trimmed = text.trim();
      if (!trimmed && images.length === 0) return;
      let sess = useSessionStore.getState().getActiveSession();
      if (!sess) sess = useSessionStore.getState().createSession();
      const sessionId = sess.id;

      // --- Motor komutları (Faz C-G): eski handleSlashCommand'dan önce ---
      const low = trimmed.toLowerCase();
      if (low === '/audit' || low.startsWith('/audit')) {
        const nRaw = trimmed.slice(6).trim();
        const n = nRaw ? Math.min(Math.max(parseInt(nRaw, 10) || 20, 1), 100) : 20;
        try {
          const rows = await readAuditLog(sessionId, n);
          if (rows.length === 0) {
            pushExtra(sessionId, { type: 'sys', content: '/// audit: kayıt yok' });
          } else {
            for (const r of rows.reverse()) {
              const d = new Date(r.ts);
              const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              pushExtra(sessionId, {
                type: 'sys',
                content: `[${hh}] ${r.tool}(${r.argsPreview}) → ${r.decision}`.slice(0, 300),
              });
            }
          }
        } catch {
          pushExtra(sessionId, { type: 'err', content: '✗ audit okunamadı' });
        }
        return;
      }
      if (low === '/compact') {
        const st = useSessionStore.getState();
        const target = st.sessions.find((s) => s.id === sessionId);
        const msgs = target?.messages ?? [];
        if (msgs.length === 0) {
          pushExtra(sessionId, { type: 'sys', content: '/// compact: özetlenecek mesaj yok' });
          return;
        }
        const settings = useSettingsStore.getState();
        const modelId = target?.model || settings.currentModel;
        const budget = budgetFor(modelId, settings.customModels);
        if (!shouldCompact(msgs, budget)) {
          pushExtra(sessionId, { type: 'sys', content: '/// compact: bağlam yeterli, özetlenmedi' });
          return;
        }
        const cfg = summarizerConfig({
          currentProvider: target?.provider ?? settings.currentProvider,
          currentModel: modelId,
          summarizerProvider: settings.summarizerProvider,
          summarizerModel: settings.summarizerModel,
          apiKeys: settings.apiKeys,
          customModels: settings.customModels,
          baseUrlOverride: settings.baseUrlOverride,
        });
        if (!cfg) {
          pushExtra(sessionId, { type: 'err', content: '✗ özetleyici anahtarı eksik · /key ile ekle' });
          return;
        }
        try {
          pushExtra(sessionId, { type: 'sys', content: '/// compact: özetleniyor…' });
          const { messages: next, dropped, kept } = await compactSessionMessages(
            msgs,
            budget,
            makeSummarizeFn(cfg),
          );
          if (dropped === 0) {
            pushExtra(sessionId, { type: 'sys', content: '/// compact: bağlam yeterli, özetlenmedi' });
            return;
          }
          useSessionStore.setState((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === sessionId ? { ...x, messages: next, updatedAt: Date.now() } : x,
            ),
          }));
          pushExtra(sessionId, {
            type: 'sys',
            content: `/// compact: ${dropped} mesaj özetlendi · ${kept} korundu · özet başa eklendi`,
          });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: `✗ compact hatası: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          });
        }
        return;
      }
      if (low === '/log' || low.startsWith('/log')) {
        // Faz 10: gözlemlenebilirlik — son kayıtlar (gizli değerler redakte).
        const nRaw = trimmed.slice(4).trim();
        const n = nRaw ? Math.min(Math.max(parseInt(nRaw, 10) || 30, 1), 100) : 30;
        const entries = recentLogs(n);
        if (entries.length === 0) {
          pushExtra(sessionId, { type: 'sys', content: '/// log: kayıt yok' });
          return;
        }
        for (const e of entries) {
          const t = new Date(e.ts);
          const hh = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
          const data = e.data !== undefined ? ` ${JSON.stringify(e.data).slice(0, 200)}` : '';
          pushExtra(sessionId, {
            type: e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : 'sys',
            content: `[${hh}] ${e.level} ${e.event}${data}`,
          });
        }
        return;
      }
      if (low === '/note' || low.startsWith('/note ')) {
        // Faz 9 (P9.3): kalıcı proje notu — `.macrocode/context.md`.
        const ws = useWorkspaceStore.getState();
        const note = trimmed.slice(5).trim();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: '✗ workspace seçilmedi · /root <yol>' });
          return;
        }
        if (!note) {
          pushExtra(sessionId, {
            type: 'sys',
            content: "/// kullanım: /note <not>  ·  notlar sonraki oturumlarda agent'a aktarılır",
          });
          return;
        }
        try {
          const line = await appendMemory(ws.root, note);
          clearRepoContextCache();
          pushExtra(sessionId, { type: 'sys', content: `/// not kaydedildi: ${line.trim()}` });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: `✗ not kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          });
        }
        return;
      }
      if (low === '/context' || low.startsWith('/context')) {
        // Faz 9 (P9.4): "agent ne biliyor?" — şeffaflık.
        const ws = useWorkspaceStore.getState();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: '✗ workspace seçilmedi · /root <yol>' });
          return;
        }
        try {
          clearRepoContextCache();
          const ctx = await buildRepoContext(ws.root, {
            model: useSessionStore.getState().getActiveSession()?.model
              || useSettingsStore.getState().currentModel,
            customModels: useSettingsStore.getState().customModels,
          });
          const lines: string[] = [
            `/// repo bağlamı: ${ctx.fileCount} dosya · anahtar dosyalar: ${
              ctx.keyFiles.length ? ctx.keyFiles.join(', ') : 'yok'
            }`,
          ];
          const map = ctx.text.split('\n').filter((l) => l.startsWith('- ')).slice(0, 25);
          if (map.length) {
            lines.push('/// harita (ilk 25):');
            lines.push(...map);
          }
          if (ctx.memory.trim()) {
            lines.push(`/// kalıcı notlar (${ctx.memory.trim().split('\n').length}):`);
            lines.push(ctx.memory.trim().split('\n').slice(-5).join('\n'));
          }
          for (const l of lines) pushExtra(sessionId, { type: 'sys', content: l });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: `✗ bağlam okunamadı: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          });
        }
        return;
      }
      if (low === '/approval' || low.startsWith('/approval ')) {
        // Faz 8 L7: onay modu artık erişilebilir (tip vardı, UI yoktu).
        const ws = useWorkspaceStore.getState();
        const arg = trimmed.slice(9).trim().toLowerCase();
        const MODES: Record<string, ApprovalMode> = {
          manual: 'manual',
          'auto-read': 'auto-read',
          'auto-edit': 'auto-edit',
        };
        if (!arg) {
          const label =
            ws.approvalMode === 'manual'
              ? 'manuel (yazma onaylı)'
              : ws.approvalMode === 'auto-read'
                ? 'salt-okunur (yazma ve komut kapalı)'
                : 'otomatik düzenleme (yazma onaysız, komut onaylı)';
          pushExtra(sessionId, { type: 'sys', content: `/// onay modu: ${label} · /approval manual|auto-read|auto-edit` });
          return;
        }
        const mode = MODES[arg];
        if (!mode) {
          pushExtra(sessionId, {
            type: 'err',
            content: '✗ geçersiz onay modu · manual | auto-read | auto-edit',
          });
          return;
        }
        useWorkspaceStore.getState().setApprovalMode(mode);
        if (mode === 'auto-edit') {
          pushExtra(sessionId, {
            type: 'warn',
            content:
              '! otomatik düzenleme: agent dosya yazma/düzenleme onayı almadan yapabilir (shell komutları hâlâ onaylı)',
          });
        }
        if (mode === 'auto-read') {
          pushExtra(sessionId, {
            type: 'warn',
            content: '! salt-okunur mod: agent dosya yazamaz, komut çalıştıramaz (yalnızca okuma/araştırma)',
          });
        }
        pushExtra(sessionId, {
          type: 'sys',
          content: `/// onay modu: ${mode}${
            ws.root ? '' : ' · (workspace yok — /root <yol> ile agent modunu aç)'
          }`,
        });
        return;
      }
      if (low === '/root' || low.startsWith('/root ')) {
        const arg = trimmed.slice(5).trim();
        if (!arg) {
          const ws = useWorkspaceStore.getState();
          pushExtra(sessionId, {
            type: 'sys',
            content: ws.root
              ? `/// workspace: ${ws.label || ws.root} · onay: ${ws.approvalMode}`
              : '/// kullanım: /root <mutlak-yol>',
          });
          return;
        }
        const label = arg.split('/').filter(Boolean).pop() ?? arg;
        useWorkspaceStore.getState().setWorkspace(arg, label);
        pushExtra(sessionId, { type: 'sys', content: `/// workspace: ${label} (${arg})` });
        return;
      }
      if (low === '/files' || low.startsWith('/files')) {
        const ws = useWorkspaceStore.getState();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: '✗ workspace seçilmedi · /root <yol>' });
          return;
        }
        try {
          if ('__TAURI_INTERNALS__' in window) {
            const { invoke } = await import('@tauri-apps/api/core');
            const entries = await invoke<Array<{ name: string; is_dir: boolean }>>('list_dir', {
              root: ws.root,
              path: '',
            });
            const names = entries.map((e) => (e.is_dir ? `${e.name}/` : e.name));
            pushExtra(sessionId, {
              type: 'sys',
              content: summarizeWorkspace(names, ws.label || ws.root),
            });
          } else {
            pushExtra(sessionId, { type: 'err', content: '✗ /files yalnızca Tauri’de çalışır' });
          }
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: `✗ /files hatası: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          });
        }
        return;
      }
      if (low === '/apply' || low.startsWith('/apply')) {
        const ws = useWorkspaceStore.getState();
        const id = trimmed.slice(6).trim();
        // Faz 1 G5: aktif run varsa aynı resolve yolundan devam et (tur kırılmaz).
        const activeRun = getActiveAgentRun(sessionId);
        const queued = pendingBySession[sessionId] ?? [];
        if (activeRun && queued.length > 0) {
          const decisions = id
            ? queued
                .filter((p) => p.id === id || p.id.startsWith(id))
                .map((p) => ({ id: p.id, approved: true }))
            : queued.map((p) => ({ id: p.id, approved: true }));
          if (id && decisions.length === 0) {
            pushExtra(sessionId, { type: 'err', content: `✗ bekleyen onay bulunamadı: ${id}` });
            return;
          }
          setPending(sessionId, []);
          const err = await resolvePending(
            sessionId,
            decisions,
            (line) => pushExtra(sessionId, line),
            (next: ToolCall[]) =>
              setPending(
                sessionId,
                next.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
              ),
          );
          if (err) pushExtra(sessionId, { type: 'err', content: err });
          return;
        }
        if (!id) {
          // Aktif run yoksa: önce kalıcı onay kuyruğu, sonra bellek patch'ler.
          const approvals = await listApprovals(sessionId);
          const pend = listPending();
          if (approvals.length === 0 && pend.length === 0) {
            pushExtra(sessionId, { type: 'sys', content: '/// bekleyen yama yok' });
          } else {
            const a = approvals.map((p) => `${p.id.slice(0, 8)} ${p.call.name}`).join(' · ');
            const b = pend.map((p) => `${p.id.slice(0, 8)} ${p.path}`).join(' · ');
            pushExtra(sessionId, { type: 'sys', content: `/// bekleyen: ${[a, b].filter(Boolean).join(' · ')}` });
          }
          return;
        }
        // Kısa id ile eşleştir (8 karakter).
        const pend = listPending();
        const full = pend.find((p) => p.id === id || p.id.startsWith(id))?.id ?? id;
        try {
          const msg = await applyPendingPatch(ws.root, full);
          pushExtra(sessionId, { type: 'sys', content: msg });
          await takeApproval(id);
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: `✗ /apply hatası: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          });
        }
        return;
      }
      if (low === '/undo' || low.startsWith('/undo')) {
        const ws = useWorkspaceStore.getState();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: '✗ workspace seçilmedi · /root ile klasör seç' });
          return;
        }
        const id = trimmed.slice(5).trim();
        try {
          const msg = await undoLastPatch(ws.root, id || undefined);
          pushExtra(sessionId, { type: 'sys', content: msg });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: `✗ /undo hatası: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
          });
        }
        return;
      }
      if (low === '/skill' || low.startsWith('/skill')) {
        const skills = listSkills();
        pushExtra(sessionId, {
          type: 'sys',
          content:
            skills.length === 0
              ? '/// skill yok'
              : `/// skills: ${skills.map((s) => `${s.name} — ${s.description}`).join(' · ')}`,
        });
        return;
      }

      if (trimmed.startsWith('/')) {
        if (images.length > 0) {
          pushExtra(sessionId, { type: 'warn', content: '! görseller komutlarda kullanılmaz · yoksayıldı' });
        }
        const ctx: CommandContext = {
          getSession: () => useSessionStore.getState().getActiveSession(),
          provider: () =>
            useSessionStore.getState().getActiveSession()?.provider ??
            useSettingsStore.getState().currentProvider,
          model: () =>
            useSessionStore.getState().getActiveSession()?.model ||
            useSettingsStore.getState().currentModel,
          createSession: () => {
            useSessionStore.getState().createSession();
          },
          clearView: () => clearView(sessionId),
          resetSession: () => {
            const s = useSessionStore.getState().getActiveSession();
            if (s) {
              useSessionStore.getState().clearSession(s.id);
              // Faz 7: sıfırlamadan sonra eski özet kullanılmaz.
              clearMemo(s.id);
            }
          },
          setProvider: (p: Provider) => {
            useSettingsStore.getState().setProvider(p);
            useSessionStore
              .getState()
              .updateSessionModel(sessionId, { provider: p, model: DEFAULT_MODELS[p] });
          },
          setModel: (m: string) => {
            const found = ALL_MODELS.find((entry) => entry.id === m);
            const settings = useSettingsStore.getState();
            if (found) {
              settings.setProvider(found.provider);
              settings.setModel(m);
              useSessionStore
                .getState()
                .updateSessionModel(sessionId, { provider: found.provider, model: m });
            } else {
              settings.setModel(m);
              useSessionStore.getState().updateSessionModel(sessionId, { model: m });
            }
          },
          setSystemPrompt: (t: string) => useSettingsStore.getState().setSystemPrompt(t),
          openSettings: () => setSettingsOpen(true),
          customModels: () => useSettingsStore.getState().customModels,
          prices: () => useSettingsStore.getState().prices,
          providerHasKey: (p: Provider) =>
            hasProviderKey(p, useSettingsStore.getState().apiKeys),
        };
        const result = handleSlashCommand(trimmed, ctx);
        if (result.lines.length > 0) {
          const base = Date.now();
          const lines: ExtraLine[] = result.lines.map((l, i) => ({
            ...l,
            id: createId(),
            ts: base + i,
          }));
          setExtrasBySession((prev) => {
            const next = [...(prev[sessionId] ?? []), ...lines];
            const capped =
              next.length > MAX_EXTRAS_PER_SESSION ? next.slice(next.length - MAX_EXTRAS_PER_SESSION) : next;
            return { ...prev, [sessionId]: capped };
          });
        }
        if (result.exportText) {
          const isJson = (result.exportMime ?? '').includes('json');
          downloadFile(
            result.exportText,
            result.exportFilename ?? stampedFilename('macrocode-session', isJson ? 'json' : 'md'),
            result.exportMime ?? (isJson ? 'application/json;charset=utf-8' : 'text/markdown;charset=utf-8'),
          );
        }
        return;
      }

      // Görsel capability kontrolü: vision'suz model + ek varsa erken hata.
      if (images.length > 0) {
        const active = useSessionStore.getState().getActiveSession();
        const modelId = active?.model || useSettingsStore.getState().currentModel;
        const caps = getCapabilitiesForModel(modelId, useSettingsStore.getState().customModels);
        if (caps && !caps.vision) {
          pushExtra(sessionId, { type: 'err', content: `✗ ${modelId} görsel desteklemiyor · vision rozetli modele geç (/model)` });
          return;
        }
      }

      // Workspace seçiliyse agent yolu (Faz 1: duraklatılabilir run).
      const wsRoot = useWorkspaceStore.getState().root;
      if (wsRoot) {
        const err = await sendAgent(
          trimmed,
          (line) => pushExtra(sessionId, line),
          images,
          (pending: ToolCall[]) =>
            setPending(
              sessionId,
              pending.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
            ),
        );
        if (err) pushExtra(sessionId, { type: 'err', content: err });
        return;
      }

      const err = await send(
        trimmed,
        images,
        (fb) => pushExtra(sessionId, { type: 'sys', content: `/// yedek model kullanıldı: ${fb}` }),
        (line) => pushExtra(sessionId, { type: 'sys', content: line }),
      );
      if (err) pushExtra(sessionId, { type: 'err', content: err });
    },
    [send, sendAgent, clearView, pushExtra, setPending],
  );

  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      await useSettingsStore.getState().loadFromStore();
      // models.dev kataloğu: önbellekten anında yükle (ağ yok), bayatsa
      // arka planda yenile — fiyatlar otomatik dolar, metadata zenginleşir.
      useSettingsStore.getState().loadModelsDevCatalog();
      void (async () => {
        const st = useSettingsStore.getState();
        if (!st.modelsDevCatalog || isStale(st.modelsDevCatalog)) {
          try {
            await st.refreshModelsDevCatalog();
          } catch {
            // Katalog kritik değil — hata sessizce geçer.
          }
        }
      })();
      // Kalicilik onceligi: SQLite > localStorage (zustand persist).
      try {
        const fromDb = await loadSessionsFromDb();
        if (fromDb && fromDb.sessions.length > 0) {
          useSessionStore.setState({
            sessions: fromDb.sessions,
            activeSessionId: fromDb.activeSessionId,
          });
        }
      } catch {
        // DB okunamazsa localStorage degeri kullanilir.
      }
      // Faz 9 P9.0: boot sonrası DB senkronizasyonu.
      // Yazma yalnızca *state değişince* tetiklendiği için (debounce persister),
      // DB boş/eskiyse localStorage'daki oturumlar bir state değişikliği olana
      // kadar DB'ye hiç yazılmıyordu → "SQLite > localStorage" önceliği
      // uygulanmıyordu. Burada mevcut durum bir kez DB'ye yansıtılır.
      try {
        const st0 = useSessionStore.getState();
        await saveSessionsToDb(st0.sessions, st0.activeSessionId);
      } catch {
        // Yazma başarısızsa localStorage yedeği devrede.
      }
      // Faz 1 G3: bekleyen onayları geri yükle (K9 kalıcı).
      try {
        const restored = await restoreApprovals();
        if (restored.length > 0) {
          const grouped: Record<string, PendingApproval[]> = {};
          for (const p of restored) {
            grouped[p.sessionId] = [...(grouped[p.sessionId] ?? []), p];
          }
          setPendingBySession(grouped);
        }
      } catch {
        // Onay geri yükleme hatası boot'u durdurmaz.
      }
      // Faz 12 B.8: kayıtlı agent durumunu geri yükle → bekleyen iş kaldığı
      // yerden sürülebilir (eskiden "yeniden başlatılamadı" deniyordu).
      let resumedRuns = 0;
      try {
        resumedRuns = await restorePendingRuns();
      } catch {
        // Geri yükleme hatası boot'u durdurmaz.
      }
      const st = useSessionStore.getState();
      let sess = st.getActiveSession();
      if (!sess) sess = st.createSession();
      const fresh = st.sessions.length <= 1 && sess.messages.length === 0;
      if (!fresh) return;
      const id = sess.id;
      const boot: Omit<TerminalLine, 'id'>[] = [
        { type: 'sys', content: '/// macrocode v0.1.0 — ai terminal interface' },
        { type: 'sys', content: `/// platform: ${detectPlatform()} · arch: ${detectArch()}` },
        { type: 'sys', content: '/// başlamak için mesajını yaz veya /help yaz' },
      ];
      for (const line of boot) {
        pushExtra(id, line);
        await sleep(100);
      }
      const ks = useSettingsStore.getState().keyStatus;
      const mark = (on: boolean) => (on ? 'bağlı ✓' : '—');
      const statusLine = `/// ${PROVIDER_IDS.map((p) => `${p}: ${mark(ks[p])}`).join('  |  ')}`;
      const anyOn = PROVIDER_IDS.some((p) => ks[p]);
      pushExtra(
        id,
        anyOn
          ? { type: 'sys', content: statusLine }
          : { type: 'sys', content: '/// api anahtarı için ⚙ ayarlar → settings' },
      );
      if (resumedRuns > 0) {
        pushExtra(id, {
          type: 'sys',
          content: `/// ${resumedRuns} oturumdaki bekleyen agent işi geri yüklendi (kaldığı yerden devam edebilir)`,
        });
      }
      // Faz 7 A1: DB açılamadıysa sessizce düşme — kullanıcıya sebebiyle birlikte bildir.
      // (ACL `sql:allow-execute` eksikliği, bozuk migration vb. burada görünür olur.)
      const dbErr = sqlError();
      if (dbErr) {
        pushExtra(id, {
          type: 'warn',
          content: `! session veritabanı açılamadı: ${dbErr.slice(0, 160)} · oturumlar yalnızca localStorage'da saklanıyor`,
        });
      }
    })();
  }, [pushExtra]);

  // Yazı boyutu ayarı -> CSS değişkeni (SettingsModal'dan canlı uygulanır).
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
  }, [fontSize]);

  // SQLite yansitma (gecikmeli; streaming'de her token'da yazmaz).
  useEffect(() => {
    const persister = createSessionPersister((sessions, activeId) => {
      void saveSessionsToDb(sessions, activeId);
    });
    const unsub = useSessionStore.subscribe((s) => {
      persister.schedule(s.sessions, s.activeSessionId);
    });
    return () => {
      unsub();
      persister.flush();
    };
  }, []);

  // Silinen session'ların extras/cleared/pending kayıtlarını temizle (memory leak önlemi).
  useEffect(() => {
    const ids = new Set(sessions.map((s) => s.id));
    // Faz 7: silinen oturumların compaction hafızası temizlenir (bellek sızıntısı yok).
    for (const id of prevSessionIdsRef.current) {
      if (!ids.has(id)) clearMemo(id);
    }
    prevSessionIdsRef.current = ids;
    setExtrasBySession((prev) => {
      const dead = Object.keys(prev).filter((k) => !ids.has(k));
      if (dead.length === 0) return prev;
      const next = { ...prev };
      for (const k of dead) delete next[k];
      return next;
    });
    setClearedBefore((prev) => {
      const dead = Object.keys(prev).filter((k) => !ids.has(k));
      if (dead.length === 0) return prev;
      const next = { ...prev };
      for (const k of dead) delete next[k];
      return next;
    });
    setPendingBySession((prev) => {
      const dead = Object.keys(prev).filter((k) => !ids.has(k));
      if (dead.length === 0) return prev;
      const next = { ...prev };
      for (const k of dead) delete next[k];
      return next;
    });
  }, [sessions]);

  // JSON yedegini ice aktar: dogrula, id cakismasinda yeni id ver, sona al.
  const importBackupText = useCallback(
    (text: string) => {
      let sess = useSessionStore.getState().getActiveSession();
      if (!sess) sess = useSessionStore.getState().createSession();
      const sessionId = sess.id;
      let imported;
      try {
        imported = parseSessionBackup(text);
      } catch (e) {
        pushExtra(sessionId, {
          type: 'err',
          content: `✗ içe aktarma başarısız: ${e instanceof Error ? e.message : String(e)}`,
        });
        return;
      }
      const store = useSessionStore.getState();
      const existing = new Set(store.sessions.map((s) => s.id));
      const fresh = imported.map((s) => {
        if (existing.has(s.id)) {
          const next = { ...s, id: createId(), updatedAt: Date.now() };
          existing.add(next.id);
          return next;
        }
        existing.add(s.id);
        return s;
      });
      useSessionStore.setState((s) => ({
        sessions: [...s.sessions, ...fresh],
        activeSessionId: fresh[fresh.length - 1]?.id ?? s.activeSessionId,
      }));
      pushExtra(sessionId, {
        type: 'sys',
        content: `/// içe aktarıldı: ${fresh.length} session`,
      });
    },
    [pushExtra],
  );

  const exportActiveJson = useCallback(() => {
    const sess = useSessionStore.getState().getActiveSession();
    if (!sess) return;
    if (sess.messages.length === 0) {
      pushExtra(sess.id, { type: 'warn', content: '! yedeklenecek mesaj yok' });
      return;
    }
    downloadFile(
      buildSessionBackup(sess),
      stampedFilename('macrocode-session', 'json'),
      'application/json;charset=utf-8',
    );
    pushExtra(sess.id, { type: 'sys', content: '/// JSON yedeği hazır · indiriliyor' });
  }, [pushExtra]);

  const importBackupFile = useCallback(
    (file: File) => {
      void file
        .text()
        .then(importBackupText)
        .catch(() => {
          const sess =
            useSessionStore.getState().getActiveSession() ??
            useSessionStore.getState().createSession();
          pushExtra(sess.id, { type: 'err', content: '✗ dosya okunamadı' });
        });
    },
    [importBackupText, pushExtra],
  );

  return (
    <div className="app">
      <Titlebar
        sessionName={session?.name ?? 'macrocode'}
        sessionProvider={session?.provider}
        sessionModel={session?.model}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="body">
        <Sidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onClear={() => {
            if (activeId) clearView(activeId);
          }}
          onExportJson={exportActiveJson}
          onImportFile={importBackupFile}
        />
        <div className="main-col">
          <Terminal
            session={session}
            extras={activeId ? (extrasBySession[activeId] ?? []) : []}
            clearedBefore={activeId ? (clearedBefore[activeId] ?? null) : null}
            pending={activeId ? (pendingBySession[activeId] ?? []) : []}
            onApprove={() => {
              if (activeId) void handleApproveAll(activeId);
            }}
            onReject={() => {
              if (activeId) void handleRejectAll(activeId);
            }}
          />
          <InputBar
            onSend={(t, imgs) => void handleSend(t, imgs)}
            onAbort={abort}
            onClear={() => {
              if (activeId) clearView(activeId);
            }}
            streaming={streaming}
            pendingCount={activeId ? (pendingBySession[activeId]?.length ?? 0) : 0}
            onApprove={() => {
              if (activeId) void handleApproveAll(activeId);
            }}
            onReject={() => {
              if (activeId) void handleRejectAll(activeId);
            }}
          />
        </div>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
