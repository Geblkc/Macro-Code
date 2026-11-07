import { useCallback, useEffect, useRef, useState } from 'react';
import Titlebar from './components/Titlebar';
import Sidebar from './components/Sidebar';
import Terminal from './components/Terminal';
import InputBar from './components/InputBar';
import StatusBar from './components/StatusBar';
import SettingsModal from './components/SettingsModal';
import StatsScreen from './components/StatsScreen';
import ConfirmDialog from './components/ConfirmDialog';
import GitPanel from './components/git/GitPanel';
import ToastHost from './components/Toast';
import { useStream } from './hooks/useStream';
import { getActiveAgentRun, useAgent } from './hooks/useAgent';
import { resetKeyHistory } from './hooks/useKeyHistory';
import { useWorkspaceStore } from './store/workspace';
import { listSkills } from './lib/engine/skills';
import { applyPendingPatch, listPending, undoLastPatch } from './lib/engine/tools/patch';
import { listApprovals, restoreApprovals, takeApproval } from './lib/engine/approvals';
import type { PendingApproval } from './lib/engine/approvals';
import type { ApprovalMode, ToolCall } from './lib/engine/types';
import { summarizeWorkspace } from './lib/engine/context';
import { compactionLimitFor } from './lib/engine/tokens';
import { clearMemo } from './lib/engine/compactionMemo';
import { appendMemory, buildRepoContext, clearRepoContextCache } from './lib/engine/repoContext';
import { checkRootExists, pickWorkspaceFolder, validateRootInput } from './lib/workspace';
import { isTauri } from './lib/tauri';
import { recentLogs } from './lib/logger';
import { compactSessionMessages, shouldCompact } from './lib/engine/compact';
import { makeSummarizeFn, summarizerConfig } from './lib/summarize';
import { buildExportMarkdown, buildSessionBackup, handleSlashCommand, parseSessionBackup, type CommandContext } from './lib/commands';
import { runGitCommand } from './lib/git/commands';
import { gitApi } from './lib/git/api';
import { useGitStore } from './store/git';
import { copyText } from './lib/clipboard';
import { createSessionPersister, loadSessionsFromDb, readAuditLog, saveSessionsToDb, sqlError } from './lib/db';
import type { ExtraLine, Provider } from './types';
import type { RetryInfo } from './lib/providers/common';
import { createId, useSessionStore } from './store/session';
import { DEFAULT_MODELS, useSettingsStore } from './store/settings';
import { APP_VERSION } from './lib/appInfo';
import {
  checkForUpdate,
  compactNotes,
  downloadAndInstallUpdate,
  downloadPercent,
  formatBytes,
  openReleasePage,
  releasePageUrl,
  shouldCheckNow,
  shouldNotify,
  updateSupport,
  type UpdateInfo,
} from './lib/update';
import { ALL_MODELS, getCapabilitiesForModel, hasProviderKey } from './lib/providers';
import { isStale } from './lib/providers/modelsDev';
import { useT } from './lib/i18n';
import { resolveLocale, setLocale } from './lib/i18n/core';

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

/** Genel onay isteği — App kökündeki tek ConfirmDialog instance'ını sürer. */
interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  initialFocus?: 'confirm' | 'cancel';
  onConfirm: () => void;
  /** Kutu iptal ile kapanırsa (promise tabanlı onaylar için). */
  onCancel?: () => void;
}

/** Geçici retry satırının sabit kimliği (extras içinde tek satır). */
const RETRY_LINE_ID = 'retry-status';

interface RetryState {
  sessionId: string;
  nextAttempt: number;
  maxAttempts: number;
  /** Geri sayımın biteceği zaman (epoch ms). */
  until: number;
}

export default function App() {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
const [statsOpen, setStatsOpen] = useState(false);
  const [extrasBySession, setExtrasBySession] = useState<Record<string, ExtraLine[]>>({});
  const [retryState, setRetryState] = useState<RetryState | null>(null);
  /** Terminal araması kapanınca giriş alanına odak döner (InputBar yayını). */
  const inputFocus = useRef<(() => void) | null>(null);
  /** Genel onay isteği — ConfirmDialog uygulama kökünde tek instance. */
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);

  /**
   * Promise tabanlı onay köprüsü (Git paneli/komutları için). Aynı
   * `ConfirmDialog` instance'ını kullanır; iptal `false` ile çözülür.
   */
  const askConfirm = useCallback(
    (req: Omit<ConfirmRequest, 'onConfirm' | 'onCancel'>) =>
      new Promise<boolean>((resolve) => {
        setConfirmReq({
          ...req,
          onConfirm: () => resolve(true),
          onCancel: () => resolve(false),
        });
      }),
    [],
  );
  const [clearedBefore, setClearedBefore] = useState<Record<string, number>>({});
  const [pendingBySession, setPendingBySession] = useState<Record<string, PendingApproval[]>>({});
  const bootedRef = useRef(false);
  /** Aynı anda birden fazla güncelleme kontrolü/indirmesi çalışmasın. */
  const updateInFlightRef = useRef(false);
  /** Son bulunan güncelleme (`/update ignore` ve `/update open` için). */
  const lastUpdateRef = useRef<UpdateInfo | null>(null);
  // Faz 7: önceki oturum id'leri (silinen oturumların compaction hafızası için).
  const prevSessionIdsRef = useRef<Set<string>>(new Set());
  const { send, abort: abortStream } = useStream();
  const { sendAgent, resolvePending, restorePendingRuns, abort: abortAgent } = useAgent();
  const abort = useCallback(() => {
    abortStream();
    abortAgent();
  }, [abortStream, abortAgent]);

  const activeId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const streaming = useSessionStore((s) => s.isStreaming);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const clockFormat = useSettingsStore((s) => s.clockFormat);
  const showTimestamps = useSettingsStore((s) => s.showTimestamps);
  const language = useSettingsStore((s) => s.language);
  const contrast = useSettingsStore((s) => s.contrast);
  const uiFont = useSettingsStore((s) => s.uiFont);
  const wsRoot = useWorkspaceStore((s) => s.root);
  const session = sessions.find((s) => s.id === activeId) ?? null;

  /**
   * Workspace değişince Git durumunu bir kez tespit et — panel kapalıyken de
   * durum çubuğundaki branch rozeti dolu olsun. Panel açıkken kendi
   * polling'i devralır.
   */
  useEffect(() => {
    if (!wsRoot) {
      useGitStore.getState().reset();
      return;
    }
    void useGitStore.getState().refresh(wsRoot);
  }, [wsRoot]);

  const MAX_EXTRAS_PER_SESSION = 200;
  /**
   * Faz 7: extras cap — sayaç pushExtra içinde senkron tutulur (aynı tick'te
   * art arda gelen eklemelerde bile ilk-kırpma anı doğru görülür); uyarı
   * bayrağı oturum başına tektir (`clearView` sayacı sıfırlar, bayrağı bırakmaz).
   */
  const extrasCountRef = useRef<Map<string, number>>(new Map());
  const extrasCappedRef = useRef<Set<string>>(new Set());
  /**
   * P0.2: aynı araç kartına ait satırlar (canlı exec çıktısı) tek kayıtta
   * güncellenir. Aksi halde saniyede onlarca parça extras cap'ini doldurup
   * eski kartları siliyordu.
   */
  const toolLineIdsRef = useRef<Map<string, Set<string>>>(new Map());

  const pushExtra = useCallback(
    (sessionId: string, line: Omit<ExtraLine, 'id' | 'ts'>) => {
      const full: ExtraLine = { ...line, id: createId(), ts: Date.now() };
      // Aynı tool id'si daha önce eklendiyse yeni satır sayma (upsert).
      let isNewToolLine = true;
      if (line.tool) {
        let ids = toolLineIdsRef.current.get(sessionId);
        if (!ids) {
          ids = new Set();
          toolLineIdsRef.current.set(sessionId, ids);
        }
        isNewToolLine = !ids.has(line.tool.id);
        if (isNewToolLine) ids.add(line.tool.id);
      }
      const count = isNewToolLine
        ? (extrasCountRef.current.get(sessionId) ?? 0) + 1
        : (extrasCountRef.current.get(sessionId) ?? 0);
      extrasCountRef.current.set(sessionId, count);
      // Uyarı kararı + ek satır updater DIŞINDA: StrictMode'da updater iki kez
      // çalışır; yan etkisiz saf kalması gerekir.
      const firstCap = isNewToolLine && count > MAX_EXTRAS_PER_SESSION && !extrasCappedRef.current.has(sessionId);
      if (firstCap) extrasCappedRef.current.add(sessionId);
      const warn: ExtraLine | null = firstCap
        ? { id: createId(), ts: Date.now(), type: 'sys', content: t('extrasCapped') }
        : null;
      setExtrasBySession((prev) => {
        const arr = prev[sessionId] ?? [];
        if (line.tool) {
          const idx = arr.findIndex((x) => x.tool?.id === line.tool!.id);
          if (idx >= 0) {
            const before = arr[idx];
            const tool = {
              ...before.tool!,
              ...line.tool,
              // Akış parçaları boş args gönderir; özgün args korunur.
              args: line.tool.args || before.tool!.args,
              output: line.tool.output ?? before.tool!.output,
            };
            const next = arr.slice();
            next[idx] = { ...before, type: line.type, content: line.content, tool };
            return { ...prev, [sessionId]: next };
          }
        }
        const next = [...arr, full, ...(warn ? [warn] : [])];
        const capped =
          next.length > MAX_EXTRAS_PER_SESSION ? next.slice(next.length - MAX_EXTRAS_PER_SESSION) : next;
        return { ...prev, [sessionId]: capped };
      });
    },
    [t],
  );

  /** Retry geri sayım satırını ekler/günceller (extras cap'ine sayılmaz). */
  const upsertRetryLine = useCallback((sessionId: string, content: string) => {
    setExtrasBySession((prev) => {
      const arr = prev[sessionId] ?? [];
      const idx = arr.findIndex((x) => x.id === RETRY_LINE_ID);
      if (idx >= 0) {
        const next = arr.slice();
        next[idx] = { ...next[idx], content, ts: Date.now() };
        return { ...prev, [sessionId]: next };
      }
      const next = [...arr, { id: RETRY_LINE_ID, ts: Date.now(), type: 'warn' as const, content }];
      return {
        ...prev,
        [sessionId]:
          next.length > MAX_EXTRAS_PER_SESSION ? next.slice(next.length - MAX_EXTRAS_PER_SESSION) : next,
      };
    });
  }, []);

  const clearRetry = useCallback((sessionId: string) => {
    setRetryState((prev) => (prev?.sessionId === sessionId ? null : prev));
    setExtrasBySession((prev) => {
      const arr = prev[sessionId];
      if (!arr || !arr.some((x) => x.id === RETRY_LINE_ID)) return prev;
      return { ...prev, [sessionId]: arr.filter((x) => x.id !== RETRY_LINE_ID) };
    });
  }, []);

  /** Retry bilgisini oturum bazında gösterir; `null` satırı temizler. */
  const reportRetry = useCallback(
    (sessionId: string, info: RetryInfo | null) => {
      if (!info) {
        clearRetry(sessionId);
        return;
      }
      setRetryState({
        sessionId,
        nextAttempt: info.nextAttempt,
        maxAttempts: info.maxAttempts,
        until: Date.now() + info.delayMs,
      });
    },
    [clearRetry],
  );

  // Saniyede iki kez güncelle: geri sayım "4 sn → 3 sn…" görünür.
  useEffect(() => {
    if (!retryState) return;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((retryState.until - Date.now()) / 1000));
      upsertRetryLine(
        retryState.sessionId,
        t('status.retrying', {
          attempt: retryState.nextAttempt,
          total: retryState.maxAttempts,
          seconds,
        }),
      );
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [retryState, t, upsertRetryLine]);

  /** Onay kartındaki "bu komutu her zaman çalıştır" kutusu -> allowlist. */
  const handleAlwaysAllow = useCallback((_sessionId: string, command: string) => {
    const line = command.trim();
    if (!line) return;
    const st = useSettingsStore.getState();
    if (st.customAllowList.includes(line)) return;
    st.setCustomAllowList([...st.customAllowList, line]);
  }, []);

  const clearView = useCallback((sessionId: string) => {
    extrasCountRef.current.set(sessionId, 0);
    toolLineIdsRef.current.delete(sessionId);
    extrasCappedRef.current.delete(sessionId);
    setExtrasBySession((prev) => ({ ...prev, [sessionId]: [] }));
    setClearedBefore((prev) => ({ ...prev, [sessionId]: Date.now() }));
  }, []);

  const setPending = useCallback((sessionId: string, pending: PendingApproval[]) => {
    setPendingBySession((prev) => ({ ...prev, [sessionId]: pending }));
  }, []);

  /** M1: kuyruktan yalnız verilen id'leri düşürür — functional update, yarış
   *  durumunda stale closure'ın eski kartı geri getirmesini önler. */
  const dropPending = useCallback((sessionId: string, ids: Set<string>) => {
    setPendingBySession((prev) => ({
      ...prev,
      [sessionId]: (prev[sessionId] ?? []).filter((p) => !ids.has(p.id)),
    }));
  }, []);

  /**
   * M1 — per-kart onay: `id` verilirse **yalnız** o bekleyen çağrı çözülür;
   * `id` yoksa tümü ("Tümünü onayla" düğmesi ve /apply `all`).
   *
   * Eski `handleApproveAll` her kartın düğmesine bağlıydı → tek tıkla bir
   * turdaki TÜM çağrılar (gizli kalmış bir `git push` dahil) çalışıyordu.
   */
  const handleApprove = useCallback(
    async (sessionId: string, id?: string) => {
      const pend = pendingBySession[sessionId] ?? [];
      if (pend.length === 0) return;
      const target = id ? pend.filter((p) => p.id === id) : pend;
      if (target.length === 0) return;
      const resolvedIds = new Set(target.map((p) => p.id));
      // Yalnız çözülenler kuyruktan düşer; diğer bekleme kartta KALIR.
      dropPending(sessionId, resolvedIds);
      const err = await resolvePending(
        sessionId,
        target.map((p) => ({ id: p.id, approved: true })),
        (line) => pushExtra(sessionId, line),
        (next: ToolCall[]) =>
          setPending(
            sessionId,
            next.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
          ),
        (info) => reportRetry(sessionId, info),
      );
      if (err) pushExtra(sessionId, { type: 'err', content: err });
    },
    [pendingBySession, resolvePending, pushExtra, setPending, dropPending, reportRetry],
  );

  /** M1: `id` yoksa tümü (toplu reddetme — Esc de buradan gelir, güvenli taraf). */
  const handleReject = useCallback(
    async (sessionId: string, id?: string) => {
      const pend = pendingBySession[sessionId] ?? [];
      if (pend.length === 0) return;
      const target = id ? pend.filter((p) => p.id === id) : pend;
      if (target.length === 0) return;
      const resolvedIds = new Set(target.map((p) => p.id));
      dropPending(sessionId, resolvedIds);
      const err = await resolvePending(
        sessionId,
        target.map((p) => ({ id: p.id, approved: false })),
        (line) => pushExtra(sessionId, line),
        (next: ToolCall[]) =>
          setPending(
            sessionId,
            next.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
          ),
        (info) => reportRetry(sessionId, info),
      );
      if (err) pushExtra(sessionId, { type: 'err', content: err });
    },
    [pendingBySession, resolvePending, pushExtra, setPending, dropPending, reportRetry],
  );

  /**
   * `/root` tek yol: klasör diyaloğu (arg boş), `off`, `1..5` (son klasörler)
   * veya elle yol — hepsi aynı doğrulama + apply katmanından geçer.
   * UI rozetleri de buraya bağlanır (sessionId verilmezse aktif session).
   */
  const applyRoot = useCallback(
    async (raw: string, sessionId: string) => {
      const check = validateRootInput(raw);
      if (!check.ok) {
        pushExtra(sessionId, { type: 'err', content: t(check.key) });
        return;
      }
      // Varlık kontrolü: Rust jail list_dir üzerinden (olmayan / dosya → hata).
      const exists = await checkRootExists(check.root);
      if (!exists) {
        pushExtra(sessionId, {
          type: 'err',
          content: t('commands.workspaceNotFound', { path: check.root }),
        });
        return;
      }
      useWorkspaceStore.getState().setWorkspace(check.root, check.label);
      pushExtra(sessionId, {
        type: 'sys',
        content: t('commands.workspaceSet', { label: check.label, path: check.root }),
      });
    },
    [t, pushExtra],
  );

  const runRootCommand = useCallback(
    async (arg: string, sessionIdInput?: string) => {
      let sess = useSessionStore.getState().getActiveSession();
      if (!sess) sess = useSessionStore.getState().createSession();
      const sessionId = sessionIdInput ?? sess.id;
      const ws = useWorkspaceStore.getState();
      if (!arg) {
        // (a) Argümansız: Tauri'de yerel klasör diyaloğu aç.
        if (isTauri()) {
          const picked = await pickWorkspaceFolder();
          if (picked) {
            await applyRoot(picked, sessionId);
          } else {
            // İptal/eski plugin: mevcut workspace bilgiyi göster.
            pushExtra(sessionId, {
              type: 'sys',
              content: ws.root
                ? t('commands.workspaceInfo', { label: ws.label || ws.root, mode: ws.approvalMode })
                : t('commands.rootUsage'),
            });
          }
          return;
        }
        // (b) Tarayıcı-dev: diyaloğu yok — usage/bilgi göster.
        pushExtra(sessionId, {
          type: 'sys',
          content: ws.root
            ? t('commands.workspaceInfo', { label: ws.label || ws.root, mode: ws.approvalMode })
            : t('commands.rootUsage'),
        });
        return;
      }
      // (c) `off` → workspace kaldır (agent modu kapanır).
      if (arg === 'off') {
        ws.clearWorkspace();
        pushExtra(sessionId, { type: 'sys', content: t('commands.workspaceCleared') });
        return;
      }
      // (d) `1..5` → son klasörlerden hızlı geçiş.
      const idxMatch = /^([1-5])$/.exec(arg);
      if (idxMatch) {
        const entry = (ws.recent ?? [])[Number(idxMatch[1]) - 1];
        if (!entry) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.workspaceRecentEmpty'),
          });
          return;
        }
        await applyRoot(entry.root, sessionId);
        return;
      }
      // (e) elle yol — aynı doğrulama.
      await applyRoot(arg, sessionId);
    },
    [t, applyRoot, pushExtra],
  );

  /** Güncelleme kontrolü — `/update` ve açılış kontrolü ortak yol. */
  const performUpdateCheck = useCallback(
    async (sessionId: string, opts: { silent?: boolean } = {}): Promise<UpdateInfo | null> => {
      if (updateInFlightRef.current) {
        if (!opts.silent) {
          pushExtra(sessionId, { type: 'sys', content: t('update.checkingShort') });
        }
        return null;
      }
      updateInFlightRef.current = true;
      if (!opts.silent) {
        pushExtra(sessionId, { type: 'sys', content: t('update.checking') });
      }
      try {
        const info = await checkForUpdate();
        useSettingsStore.getState().setLastUpdateCheck(Date.now());
        if (!info) {
          if (!opts.silent) {
            pushExtra(sessionId, {
              type: 'sys',
              content: t('update.upToDate', { current: APP_VERSION }),
            });
          }
          return null;
        }
        lastUpdateRef.current = info;
        if (!opts.silent) {
          pushExtra(sessionId, {
            type: 'sys',
            content: t('update.available', {
              version: info.version,
              current: info.currentVersion,
            }),
          });
          if (info.date) {
            pushExtra(sessionId, {
              type: 'sys',
              content: t('update.releasedAt', { date: info.date }),
            });
          }
          const notes = compactNotes(info.notes);
          if (notes) {
            pushExtra(sessionId, {
              type: 'sys',
              content: t('update.releaseNotes', { notes }),
            });
          }
        }
        return info;
      } catch (e) {
        if (!opts.silent) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('update.checkFailed', {
              message: e instanceof Error ? e.message : String(e),
            }),
          });
        }
        return null;
      } finally {
        updateInFlightRef.current = false;
      }
    },
    [pushExtra, t],
  );

  /** Güncellemeyi indirir + kurar (onay `/update` akışında alınır). */
  const runUpdateInstall = useCallback(
    async (sessionId: string, info: UpdateInfo) => {
      pushExtra(sessionId, {
        type: 'sys',
        content: t('update.installing', { version: info.version }),
      });
      let lastPercent = -10;
      let lastAt = 0;
      try {
        await downloadAndInstallUpdate((p) => {
          if (p.phase === 'finished') {
            pushExtra(sessionId, { type: 'sys', content: t('update.installed') });
            return;
          }
          const now = Date.now();
          const percent = downloadPercent(p);
          if (percent < 0) {
            if (now - lastAt < 1000) return;
            lastAt = now;
            pushExtra(sessionId, {
              type: 'sys',
              content: t('update.downloadProgressUnknown', {
                downloaded: formatBytes(p.downloaded),
              }),
            });
            return;
          }
          // Her %10'da bir veya en fazla saniyede bir satır (terminal spam'i yok).
          if (percent < lastPercent + 10 && now - lastAt < 1000) return;
          lastPercent = percent;
          lastAt = now;
          pushExtra(sessionId, {
            type: 'sys',
            content: t('update.downloadProgress', {
              percent,
              downloaded: formatBytes(p.downloaded),
              total: formatBytes(p.total),
            }),
          });
        });
        pushExtra(sessionId, { type: 'sys', content: t('update.relaunching') });
      } catch (e) {
        pushExtra(sessionId, {
          type: 'err',
          content: t('update.installFailed', {
            message: e instanceof Error ? e.message : String(e),
          }),
        });
        const url = lastUpdateRef.current?.url;
        if (url) {
          pushExtra(sessionId, {
            type: 'sys',
            content: t('update.manualHint', { url }),
          });
        }
      }
    },
    [pushExtra, t],
  );

  /** Faz 4: hata satırındaki "tekrar dene" aynı girdiyi yeniden gönderir. */
  const handleSendRef = useRef<((text: string, images?: string[]) => void) | null>(null);

  const handleSend = useCallback(
    async (text: string, images: string[] = []) => {
      const trimmed = text.trim();
      if (!trimmed && images.length === 0) return;
      let sess = useSessionStore.getState().getActiveSession();
      if (!sess) sess = useSessionStore.getState().createSession();
      const sessionId = sess.id;

      // --- Motor komutları (Faz C-G): eski handleSlashCommand'dan önce ---
      const low = trimmed.toLowerCase();
      if (low === '/audit' || low.startsWith('/audit ')) {
        const nRaw = trimmed.slice(6).trim();
        const n = nRaw ? Math.min(Math.max(parseInt(nRaw, 10) || 20, 1), 100) : 20;
        try {
          const rows = await readAuditLog(sessionId, n);
          if (rows.length === 0) {
            pushExtra(sessionId, { type: 'sys', content: t('commands.auditEmpty') });
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
          pushExtra(sessionId, { type: 'err', content: t('commands.auditFailed') });
        }
        return;
      }
      if (low === '/compact') {
        const st = useSessionStore.getState();
        const target = st.sessions.find((s) => s.id === sessionId);
        const msgs = target?.messages ?? [];
        if (msgs.length === 0) {
          pushExtra(sessionId, { type: 'sys', content: t('commands.compactNoMessages') });
          return;
        }
        const settings = useSettingsStore.getState();
        const modelId = target?.model || settings.currentModel;
        const limit = compactionLimitFor(modelId, settings.customModels);
        if (!shouldCompact(msgs, limit)) {
          pushExtra(sessionId, { type: 'sys', content: t('commands.compactNotNeeded') });
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
          pushExtra(sessionId, { type: 'err', content: t('commands.compactNoKey') });
          return;
        }
        try {
          pushExtra(sessionId, { type: 'sys', content: t('commands.compactRunning') });
          const { messages: next, dropped, kept } = await compactSessionMessages(
            msgs,
            limit,
            makeSummarizeFn(cfg),
          );
          if (dropped === 0) {
            pushExtra(sessionId, { type: 'sys', content: t('commands.compactNotNeeded') });
            return;
          }
          useSessionStore.setState((s) => ({
            sessions: s.sessions.map((x) =>
              x.id === sessionId ? { ...x, messages: next, updatedAt: Date.now() } : x,
            ),
          }));
          pushExtra(sessionId, {
            type: 'sys',
            content: t('commands.compactDone', { dropped, kept }),
          });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.compactFailed', { message: e instanceof Error ? e.message : String(e) }).slice(0, 300),
          });
        }
        return;
      }
      if (low === '/copy' || low.startsWith('/copy ')) {
        // /export'ın dosyasız ikizi: transkript panoya (varsayılan md, [json]).
        const active = useSessionStore.getState().getActiveSession();
        if (!active || active.messages.length === 0) {
          pushExtra(sessionId, { type: 'warn', content: t('commands.copyEmpty') });
          return;
        }
        const copyArg = trimmed.slice(5).trim().toLowerCase();
        const text = copyArg === 'json' ? buildSessionBackup(active) : buildExportMarkdown(active);
        const ok = await copyText(text);
        pushExtra(sessionId, {
          type: ok ? 'sys' : 'err',
          content: ok ? t('commands.copyDone') : t('commands.copyFailed'),
        });
        return;
      }
      if (low === '/log' || low.startsWith('/log ')) {
        // Faz 10: gözlemlenebilirlik — son kayıtlar (gizli değerler redakte).
        const nRaw = trimmed.slice(4).trim();
        const n = nRaw ? Math.min(Math.max(parseInt(nRaw, 10) || 30, 1), 100) : 30;
        const entries = recentLogs(n);
        if (entries.length === 0) {
          pushExtra(sessionId, { type: 'sys', content: t('commands.logEmpty') });
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
      if (low === '/update' || low.startsWith('/update ')) {
        const action = trimmed.slice(7).trim().toLowerCase();
        if (!action || action === 'check') {
          const info = await performUpdateCheck(sessionId);
          if (!info) return;
          const support = await updateSupport();
          if (!support.supported) {
            pushExtra(sessionId, {
              type: 'warn',
              content: t('update.unsupported', { kind: support.kind }),
            });
            pushExtra(sessionId, {
              type: 'sys',
              content: t('update.manualHint', { url: info.url }),
            });
            return;
          }
          // Tam otomatik kurulum: kullanıcı onayı ile indir + kur + yeniden başlat.
          setConfirmReq({
            title: t('update.installTitle'),
            message: t('update.installMessage', { version: info.version }),
            confirmLabel: t('update.installConfirm'),
            cancelLabel: t('common.cancel'),
            initialFocus: 'cancel',
            onConfirm: () => {
              void runUpdateInstall(sessionId, info);
            },
          });
          return;
        }
        if (action === 'install') {
          const info = await performUpdateCheck(sessionId);
          if (!info) return;
          const support = await updateSupport();
          if (!support.supported) {
            pushExtra(sessionId, {
              type: 'warn',
              content: t('update.unsupported', { kind: support.kind }),
            });
            pushExtra(sessionId, {
              type: 'sys',
              content: t('update.manualHint', { url: info.url }),
            });
            return;
          }
          await runUpdateInstall(sessionId, info);
          return;
        }
        if (action === 'open') {
          const url = lastUpdateRef.current?.url ?? releasePageUrl();
          try {
            await openReleasePage(url);
            pushExtra(sessionId, { type: 'sys', content: t('update.open') });
          } catch {
            pushExtra(sessionId, {
              type: 'err',
              content: t('update.openFailed', { url }),
            });
          }
          return;
        }
        if (action === 'ignore') {
          const info = lastUpdateRef.current;
          if (!info) {
            pushExtra(sessionId, { type: 'sys', content: t('update.ignoreNone') });
            return;
          }
          useSettingsStore.getState().setIgnoredUpdateVersion(info.version);
          pushExtra(sessionId, {
            type: 'sys',
            content: t('update.ignored', { version: info.version }),
          });
          return;
        }
        pushExtra(sessionId, { type: 'sys', content: t('update.usage') });
        return;
      }
      if (low === '/note' || low.startsWith('/note ')) {
        // Faz 9 (P9.3): kalıcı proje notu — `.macrocode/context.md`.
        const ws = useWorkspaceStore.getState();
        const note = trimmed.slice(5).trim();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: t('commands.workspaceMissing') });
          return;
        }
        if (!note) {
          pushExtra(sessionId, {
            type: 'sys',
            content: t('commands.noteUsage'),
          });
          return;
        }
        try {
          const line = await appendMemory(ws.root, note);
          clearRepoContextCache();
          pushExtra(sessionId, { type: 'sys', content: t('commands.noteSaved', { note: line.trim() }) });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.noteFailed', { message: e instanceof Error ? e.message : String(e) }).slice(0, 300),
          });
        }
        return;
      }
      if (low === '/context' || low.startsWith('/context ')) {
        // Faz 9 (P9.4): "agent ne biliyor?" — şeffaflık.
        const ws = useWorkspaceStore.getState();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: t('commands.workspaceMissing') });
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
            t('commands.contextSummary', {
              count: ctx.fileCount,
              files: ctx.keyFiles.length ? ctx.keyFiles.join(', ') : t('common.none'),
            }),
          ];
          const map = ctx.text.split('\n').filter((l) => l.startsWith('- ')).slice(0, 25);
          if (map.length) {
            lines.push(t('commands.contextMap'));
            lines.push(...map);
          }
          if (ctx.memory.trim()) {
            lines.push(t('commands.contextNotes', { count: ctx.memory.trim().split('\n').length }));
            lines.push(ctx.memory.trim().split('\n').slice(-5).join('\n'));
          }
          for (const l of lines) pushExtra(sessionId, { type: 'sys', content: l });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.contextFailed', { message: e instanceof Error ? e.message : String(e) }).slice(0, 300),
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
              ? t('commands.approval.manual')
              : ws.approvalMode === 'auto-read'
                ? t('commands.approval.autoRead')
                : t('commands.approval.autoEdit');
          pushExtra(sessionId, { type: 'sys', content: t('commands.approvalCurrent', { mode: label }) });
          return;
        }
        const mode = MODES[arg];
        if (!mode) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.approvalInvalid'),
          });
          return;
        }
        useWorkspaceStore.getState().setApprovalMode(mode);
        if (mode === 'auto-edit') {
          pushExtra(sessionId, {
            type: 'warn',
            content: t('commands.approvalAutoEditWarn'),
          });
        }
        if (mode === 'auto-read') {
          pushExtra(sessionId, {
            type: 'warn',
            content: t('commands.approvalAutoReadWarn'),
          });
        }
        pushExtra(sessionId, {
          type: 'sys',
          content:
            t('commands.approvalSet', { mode }) + (ws.root ? '' : t('commands.approvalNoWorkspace')),
        });
        return;
      }
      if (
        low === '/mode' ||
        low.startsWith('/mode ') ||
        low === '/build' ||
        low === '/plan' ||
        low === '/ask'
      ) {
        let targetMode: 'build' | 'plan' | 'ask' | '' = '';
        if (low === '/build') targetMode = 'build';
        else if (low === '/plan') targetMode = 'plan';
        else if (low === '/ask') targetMode = 'ask';
        else {
          const arg = trimmed.slice(5).trim().toLowerCase();
          if (arg === 'build' || arg === 'plan' || arg === 'ask') {
            targetMode = arg;
          } else if (arg) {
            pushExtra(sessionId, {
              type: 'err',
              content: t('commands.modeInvalid'),
            });
            return;
          }
        }

        const session = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        const currentMode = session?.agentMode ?? 'build';

        if (!targetMode) {
          pushExtra(sessionId, {
            type: 'sys',
            content: t('commands.modeCurrent', { mode: t(`mode.${currentMode}` as any) }),
          });
          return;
        }

        useSessionStore.getState().setAgentMode(sessionId, targetMode);
        pushExtra(sessionId, {
          type: 'sys',
          content: t('commands.modeSet', { mode: t(`mode.${targetMode}` as any) }),
        });
        return;
      }
      if (low === '/root' || low.startsWith('/root ')) {
        // Klasör seçme altyapısı: diyaloğu / off / 1..5 / elle yol — tek yol.
        await runRootCommand(trimmed.slice(5).trim(), sessionId);
        return;
      }
      if (low === '/files' || low.startsWith('/files ')) {
        const ws = useWorkspaceStore.getState();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: t('commands.workspaceMissing') });
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
            pushExtra(sessionId, { type: 'err', content: t('commands.filesTauriOnly') });
          }
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.filesFailed', { message: e instanceof Error ? e.message : String(e) }).slice(0, 300),
          });
        }
        return;
      }
      if (low === '/apply' || low.startsWith('/apply ')) {
        const ws = useWorkspaceStore.getState();
        const id = trimmed.slice(6).trim();
        // Faz 1 G5: aktif run varsa aynı resolve yolundan devam et (tur kırılmaz).
        const activeRun = getActiveAgentRun(sessionId);
        const queued = pendingBySession[sessionId] ?? [];
        if (activeRun && queued.length > 0) {
          // M1: `all` = tümünü onayla; id'siz + TEK bekleyen = o tek onay;
          // id'siz + ÇOKLU = hata + liste (artık toplu onay sessizce olmaz).
          if (id && id !== 'all') {
            const matches = queued.filter((p) => p.id === id || p.id.startsWith(id));
            if (matches.length === 0) {
              pushExtra(sessionId, { type: 'err', content: t('commands.applyNotFound', { id }) });
              return;
            }
            if (matches.length > 1) {
              // M1: kısa/belirsiz önek birden fazla kartı sessizce onaylamasın.
              const list = matches.map((p) => `${p.id.slice(0, 8)} ${p.call.name}`).join(' · ');
              pushExtra(sessionId, {
                type: 'err',
                content: t('commands.applyNeedId', { list }),
              });
              return;
            }
            const decisions = matches.map((p) => ({ id: p.id, approved: true }));
            const resolvedIds = new Set(decisions.map((d) => d.id));
            dropPending(sessionId, resolvedIds);
            const err = await resolvePending(
              sessionId,
              decisions,
              (line) => pushExtra(sessionId, line),
              (next: ToolCall[]) =>
                setPending(
                  sessionId,
                  next.map((c) => ({ id: c.id, sessionId, call: c, createdAt: Date.now() })),
                ),
              (info) => reportRetry(sessionId, info),
            );
            if (err) pushExtra(sessionId, { type: 'err', content: err });
            return;
          }
          if (!id && queued.length > 1) {
            const list = queued.map((p) => `${p.id.slice(0, 8)} ${p.call.name}`).join(' · ');
            pushExtra(sessionId, {
              type: 'err',
              content: t('commands.applyNeedId', { list }),
            });
            return;
          }
          const decisions = queued.map((p) => ({ id: p.id, approved: true }));
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
            (info) => reportRetry(sessionId, info),
          );
          if (err) pushExtra(sessionId, { type: 'err', content: err });
          return;
        }
        if (!id) {
          // Aktif run yoksa: önce kalıcı onay kuyruğu, sonra bellek patch'ler.
          const approvals = await listApprovals(sessionId);
          const pend = listPending();
          if (approvals.length === 0 && pend.length === 0) {
            pushExtra(sessionId, { type: 'sys', content: t('commands.applyNone') });
          } else {
            const a = approvals.map((p) => `${p.id.slice(0, 8)} ${p.call.name}`).join(' · ');
            const b = pend.map((p) => `${p.id.slice(0, 8)} ${p.path}`).join(' · ');
            pushExtra(sessionId, { type: 'sys', content: t('commands.applyPending', { list: [a, b].filter(Boolean).join(' · ') }) });
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
            content: t('commands.applyFailed', { message: e instanceof Error ? e.message : String(e) }).slice(0, 300),
          });
        }
        return;
      }
      if (low === '/undo' || low.startsWith('/undo ')) {
        const ws = useWorkspaceStore.getState();
        if (!ws.root) {
          pushExtra(sessionId, { type: 'err', content: t('commands.workspaceMissingRoot') });
          return;
        }
        const id = trimmed.slice(5).trim();
        try {
          const msg = await undoLastPatch(ws.root, id || undefined);
          pushExtra(sessionId, { type: 'sys', content: msg });
        } catch (e) {
          pushExtra(sessionId, {
            type: 'err',
            content: t('commands.undoFailed', { message: e instanceof Error ? e.message : String(e) }).slice(0, 300),
          });
        }
        return;
      }
      if (low === '/skill' || low.startsWith('/skill ')) {
        const skills = listSkills();
        pushExtra(sessionId, {
          type: 'sys',
          content:
            skills.length === 0
              ? t('commands.skillNone')
              : t('commands.skillList', {
                  list: skills.map((s) => `${s.name} — ${s.description}`).join(' · '),
                }),
        });
        return;
      }

      if (trimmed.startsWith('/')) {
        if (images.length > 0) {
          pushExtra(sessionId, { type: 'warn', content: t('commands.imagesIgnored') });
        }
        // Git komutları: generic handleSlashCommand'dan önce (async + onay).
        if (trimmed === '/git' || trimmed.startsWith('/git ')) {
          const handled = await runGitCommand(trimmed, {
            root: useWorkspaceStore.getState().root,
            api: gitApi,
            push: (line) => pushExtra(sessionId, line),
            openPanel: () => useGitStore.getState().setOpen(true),
            confirm: askConfirm,
          });
          if (handled) {
            // Panel kapalıyken de durum çubuğu rozeti güncel kalsın.
            void useGitStore.getState().refresh(useWorkspaceStore.getState().root);
            return;
          }
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
            // Faz 3: giriş geçmişi de temizlenir (persist dahil).
            resetKeyHistory();
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
          // Faz 7: tek tek pushExtra — cap + ilk kırpma uyarısı tek yerde yaşar.
          for (const l of result.lines) pushExtra(sessionId, l);
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
          pushExtra(sessionId, { type: 'err', content: t('errors.visionUnsupported', { model: modelId }) });
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
          (info) => reportRetry(sessionId, info),
        );
        if (err)
          pushExtra(sessionId, {
            type: 'err',
            content: err,
            retry: () => handleSendRef.current?.(trimmed, images),
          });
        return;
      }

      const err = await send(
        trimmed,
        images,
        (fb) => pushExtra(sessionId, { type: 'sys', content: t('agent.fallbackUsed', { model: fb }) }),
        (line) => pushExtra(sessionId, { type: 'sys', content: line }),
        (info) => reportRetry(sessionId, info),
      );
      if (err)
        pushExtra(sessionId, {
          type: 'err',
          content: err,
          retry: () => handleSendRef.current?.(trimmed, images),
        });
    },
    [
      send,
      sendAgent,
      clearView,
      pushExtra,
      setPending,
      dropPending,
      runRootCommand,
      performUpdateCheck,
      runUpdateInstall,
      askConfirm,
      reportRetry,
      t,
    ],
  );
  handleSendRef.current = handleSend;

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
          // O7 düzeltmesi: SQLite > localStorage önceliği yalnızca DB "taze"
          // iken geçerli; localStorage'daki son debounced yazma DB
          // snapshot'ından YENİ ise (kapanış anındaki son fark) eski DB,
          // gövdeyi ezip yeni oturumları kaybetmemeli. En yeni `updatedAt`
          // ile karşılaştırılır; eşitlikte DB kazanır (asıl depo).
          const st = useSessionStore.getState();
          const dbFresh = Math.max(0, ...fromDb.sessions.map((s) => s.updatedAt ?? 0));
          const tlsFresh = Math.max(0, ...st.sessions.map((s) => s.updatedAt ?? 0));
          if (dbFresh >= tlsFresh) {
            useSessionStore.setState({
              sessions: fromDb.sessions,
              activeSessionId: fromDb.activeSessionId,
            });
          }
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
        resumedRuns = await restorePendingRuns((sessionId, info) => reportRetry(sessionId, info));
      } catch {
        // Geri yükleme hatası boot'u durdurmaz.
      }
      const st = useSessionStore.getState();
      let sess = st.getActiveSession();
      if (!sess) sess = st.createSession();
      // Güncelleme: açılışta günde en fazla bir kez, arka planda (boot'u durdurmaz).
      if (isTauri()) {
        const updState = useSettingsStore.getState();
        if (updState.autoUpdateCheck && shouldCheckNow(updState.lastUpdateCheck)) {
          void (async () => {
            try {
              const info = await checkForUpdate();
              // Yalnızca başarılı kontrolde damga yazılır; ağ hatasında
              // sonraki açılışta yeniden denenir.
              useSettingsStore.getState().setLastUpdateCheck(Date.now());
              if (!info) return;
              const freshState = useSettingsStore.getState();
              if (!shouldNotify(info.version, freshState.ignoredUpdateVersion)) return;
              lastUpdateRef.current = info;
              const active = useSessionStore.getState().getActiveSession();
              if (active) {
                pushExtra(active.id, {
                  type: 'warn',
                  content: t('update.availableShort', { version: info.version }),
                });
              }
            } catch {
              // Ağ hatası boot'u etkilemez.
            }
          })();
        }
      }
      // Klasör seçme altyapısı (boot): persist edilmiş kök artık yoksa uyar —
      // otomatik silme yok (kullanıcı /root veya rozet ile karar verir).
      try {
        const wsBoot = useWorkspaceStore.getState();
        if (wsBoot.root) {
          const rootOk = await checkRootExists(wsBoot.root);
          if (!rootOk) {
            pushExtra(sess.id, {
              type: 'warn',
              content: t('commands.workspaceNotFound', { path: wsBoot.root }),
            });
          }
        }
      } catch {
        // Kontrol hatası boot'u durdurmaz.
      }
      const fresh = st.sessions.length <= 1 && sess.messages.length === 0;
      if (!fresh) return;
      const id = sess.id;
      // Boot bilgisi artık durum çubuğunda (sağlayıcı noktası + model + token).
      // Boş oturumda karşılama ekranı gösterilir; ek satırla bozulmaz.
      if (resumedRuns > 0) {
        pushExtra(id, {
          type: 'sys',
          content: t('agent.runsRestored', { count: resumedRuns }),
        });
      }
      // Faz 7 A1: DB açılamadıysa sessizce düşme — kullanıcıya sebebiyle birlikte bildir.
      // (ACL `sql:allow-execute` eksikliği, bozuk migration vb. burada görünür olur.)
      const dbErr = sqlError();
      if (dbErr) {
        pushExtra(id, {
          type: 'warn',
          content: t('errors.dbUnavailable', { message: dbErr.slice(0, 160) }),
        });
      }
    })();
  }, [pushExtra]);

  // Yazı boyutu ayarı -> CSS değişkeni (SettingsModal'dan canlı uygulanır).
  useEffect(() => {
    document.documentElement.style.setProperty('--font-size', `${fontSize}px`);
  }, [fontSize]);

  // Dil ayarı -> modül geneli locale + <html lang> (React dışı çağıranlar için).
  useEffect(() => {
    setLocale(resolveLocale(language));
  }, [language]);

  // Görünüm tercihleri -> <html> nitelikleri (high-contrast.css bunları okur).
  useEffect(() => {
    document.documentElement.setAttribute('data-contrast', contrast);
  }, [contrast]);

  useEffect(() => {
    document.documentElement.setAttribute('data-uifont', uiFont);
  }, [uiFont]);

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
    // Faz 7: extras cap sayaçları da yalnız yaşayan oturumlar için tutulur.
    for (const id of [...extrasCountRef.current.keys()]) {
      if (!ids.has(id)) {
        extrasCountRef.current.delete(id);
        extrasCappedRef.current.delete(id);
      }
    }
    // P0.2: silinen oturumların tool kartı kimlikleri de bırakılmaz.
    for (const id of [...toolLineIdsRef.current.keys()]) {
      if (!ids.has(id)) toolLineIdsRef.current.delete(id);
    }
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
          content: t('commands.importFailed', { message: e instanceof Error ? e.message : String(e) }),
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
        content: t('commands.imported', { count: fresh.length }),
      });
    },
    [pushExtra],
  );

  const exportActiveJson = useCallback(() => {
    const sess = useSessionStore.getState().getActiveSession();
    if (!sess) return;
    if (sess.messages.length === 0) {
      pushExtra(sess.id, { type: 'warn', content: t('commands.backupEmpty') });
      return;
    }
    downloadFile(
      buildSessionBackup(sess),
      stampedFilename('macrocode-session', 'json'),
      'application/json;charset=utf-8',
    );
    pushExtra(sess.id, { type: 'sys', content: t('commands.jsonReady') });
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
          pushExtra(sess.id, { type: 'err', content: t('commands.fileUnreadable') });
        });
    },
    [importBackupText, pushExtra],
  );

  // ── Faz 3: global oturum kısayolları ──────────────────────────────
  // Ctrl+N yeni oturum · Ctrl+Tab / Ctrl+Shift+Tab oturum gezinmesi.
  // Modifier'lı olduğu için IME'den bağımsız; ayarlar modalı açıkken pasif.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (settingsOpen) return;
      // IME bestesi sırasında kısayollar tetiklenmez (Faz 4).
      if (e.isComposing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      // Ctrl+C: metin seçiliyse kopyalamaya bırak; seçim yok ve akış
      // sürüyorsa iptal et (terminal davranışı — Faz 4).
      if (e.key.toLowerCase() === 'c' && !e.shiftKey) {
        if (window.getSelection()?.toString()) return;
        if (!streaming) return;
        e.preventDefault();
        abort();
        return;
      }
      if (e.key === 'Tab') {
        const { sessions, activeSessionId, setActiveSession } = useSessionStore.getState();
        if (sessions.length < 2) return;
        e.preventDefault();
        const idx = sessions.findIndex((s) => s.id === activeSessionId);
        const next = e.shiftKey
          ? idx <= 0
            ? sessions.length - 1
            : idx - 1
          : idx === -1 || idx === sessions.length - 1
            ? 0
            : idx + 1;
        setActiveSession(sessions[next].id);
        return;
      }
      if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
        e.preventDefault();
        useSessionStore.getState().createSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen, streaming, abort]);

  return (
    <div className="app">
      <Titlebar
        sessionName={session?.name ?? 'macrocode'}
        sessionProvider={session?.provider}
        sessionModel={session?.model}
        onOpenSettings={() => setSettingsOpen(true)}
        onRootCommand={(arg) => void runRootCommand(arg)}
      />
      <div className="body">
        <Sidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenStats={() => setStatsOpen(true)}
          onClear={() => {
            if (activeId) clearView(activeId);
          }}
          onExportJson={exportActiveJson}
          onImportFile={importBackupFile}
          onRequestDelete={(id, name) =>
            setConfirmReq({
              title: t('sidebar.confirmDeleteTitle'),
              message: t('sidebar.confirmDeleteMessage', { name }),
              confirmLabel: t('sidebar.confirmDeleteOk'),
              cancelLabel: t('common.cancel'),
              danger: true,
              // Silme gibi geri alınamaz işlemde odak güvenli tarafa.
              initialFocus: 'cancel',
              onConfirm: () => useSessionStore.getState().deleteSession(id),
            })
          }
        />
        <div className="main-col">
          <Terminal
            session={session}
            extras={activeId ? (extrasBySession[activeId] ?? []) : []}
            clearedBefore={activeId ? (clearedBefore[activeId] ?? null) : null}
            pending={activeId ? (pendingBySession[activeId] ?? []) : []}
            clockFormat={clockFormat}
            showTimestamps={showTimestamps}
            onApprove={(id) => {
              if (activeId) void handleApprove(activeId, id);
            }}
            onReject={(id) => {
              if (activeId) void handleReject(activeId, id);
            }}
            onApproveAll={() => {
              if (activeId) void handleApprove(activeId);
            }}
            onRejectAll={() => {
              if (activeId) void handleReject(activeId);
            }}
            onAlwaysAllow={
              (cmd) => {
                if (activeId) handleAlwaysAllow(activeId, cmd);
              }
            }
            onRootCommand={(arg) => void runRootCommand(arg)}
            onFocusInput={() => inputFocus.current?.()}
            searchEnabled={!settingsOpen}
          />
          <InputBar
            onSend={(t, imgs) => void handleSend(t, imgs)}
            onAbort={abort}
            onClear={() => {
              if (activeId) clearView(activeId);
            }}
            streaming={streaming}
            pendingCount={activeId ? (pendingBySession[activeId]?.length ?? 0) : 0}
            // Enter yalnız TEK bekleyende onaylar (InputBar'da sınırlandırılır);
            // Esc toplu reddetme — güvenli taraf (id'siz = tümü).
            onApprove={() => {
              if (activeId) void handleApprove(activeId);
            }}
            onReject={() => {
              if (activeId) void handleReject(activeId);
            }}
            focusRef={inputFocus}
            mode={session?.agentMode ?? 'build'}
            onModeChange={(m) => {
              if (activeId) {
                useSessionStore.getState().setAgentMode(activeId, m);
              }
            }}
          />
        </div>
        <GitPanel confirm={askConfirm} />
      </div>
      <StatusBar
        pendingCount={activeId ? (pendingBySession[activeId]?.length ?? 0) : 0}
        isStreaming={streaming}
        onPendingClick={() => {
          const el = document.querySelector('.approval');
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        onWorkspaceClick={() => void runRootCommand('')}
        onCompact={streaming ? undefined : () => handleSendRef.current?.('/compact')}
        onGitClick={() => useGitStore.getState().toggle()}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <StatsScreen open={statsOpen} onClose={() => setStatsOpen(false)} />
      <ConfirmDialog
        open={confirmReq !== null}
        title={confirmReq?.title ?? ''}
        message={confirmReq?.message ?? ''}
        confirmLabel={confirmReq?.confirmLabel ?? ''}
        cancelLabel={confirmReq?.cancelLabel ?? ''}
        danger={confirmReq?.danger}
        initialFocus={confirmReq?.initialFocus}
        onConfirm={() => {
          confirmReq?.onConfirm();
          setConfirmReq(null);
        }}
        onCancel={() => {
          confirmReq?.onCancel?.();
          setConfirmReq(null);
        }}
      />
      <ToastHost />
    </div>
  );
}
