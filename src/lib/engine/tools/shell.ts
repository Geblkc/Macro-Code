/**
 * Faz E — Shell aracı (onaylı + allowlist'li).
 *
 * P0.2: komut artık `exec_cmd_stream` üzerinden canlı akar; timeout komut
 * türüne göre belirlenir (test/build/normal) ve `timeoutMs` argümanı ile
 * çağrı bazında ayarlanabilir. Sıfırdan farklı çıkış kodu / iptal / timeout
 * başarısız tool sonucu olarak fırlatılır (eskiden `ok: true` görünüyordu).
 */
import { strArg } from '../toolspec';
import type { ToolCall } from '../types';
import { decideTool, isPathSafe } from '../policy';
import type { ApprovalMode } from '../types';
import { t } from '../../i18n/core';

export interface ExecResult {
  stdout: string;
  code: number;
  truncated: boolean;
}

interface ExecOut {
  stdout: string;
  stderr: string;
  code: number;
  truncated: boolean;
  cancelled?: boolean;
  timed_out?: boolean;
}

/** P0.2 — Rust `ExecEvent` ile birebir (tag: `k`). */
type ExecEvent =
  | { k: 'stdout'; data: string }
  | { k: 'stderr'; data: string }
  | { k: 'exit'; code: number; truncated: boolean; cancelled: boolean; timed_out: boolean };

export type ExecStream = 'stdout' | 'stderr';

export const EXEC_TIMEOUT_MIN_MS = 1_000;
export const EXEC_TIMEOUT_MAX_MS = 600_000;
/** Normal komut varsayılanı (eski 15 sn yerine). */
export const EXEC_TIMEOUT_NORMAL_MS = 30_000;
/** Test/check/lint varsayılanı. */
export const EXEC_TIMEOUT_TEST_MS = 120_000;
/** Build/install/paketleme varsayılanı. */
export const EXEC_TIMEOUT_BUILD_MS = 300_000;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Komut türüne göre makul varsayılan timeout. Model `timeoutMs` vermezse
 * kullanılır; ayarlardan gelen genel üst sınır `maxTimeoutMs` ile kırpılır.
 */
export function execTimeoutFor(cmd: string, args: string[]): number {
  const c = cmd.trim();
  const sub = (args[0] ?? '').toLowerCase();
  const second = (args[1] ?? '').toLowerCase();
  const joined = `${sub} ${second}`;

  // Paket yöneticileri: build/install uzun, test orta, diğer kısa.
  if (c === 'npm' || c === 'pnpm' || c === 'yarn' || c === 'bun') {
    if (/(build|bundle|package|install|ci|publish)/.test(joined)) return EXEC_TIMEOUT_BUILD_MS;
    if (sub === 'test' || sub === 'run') {
      return /(test|check|lint|typecheck)/.test(joined)
        ? EXEC_TIMEOUT_TEST_MS
        : EXEC_TIMEOUT_BUILD_MS;
    }
    return EXEC_TIMEOUT_NORMAL_MS;
  }
  if (c === 'cargo') {
    if (sub === 'build' || sub === 'install' || sub === 'publish') return EXEC_TIMEOUT_BUILD_MS;
    if (['test', 'check', 'clippy', 'bench', 'doc'].includes(sub)) return EXEC_TIMEOUT_TEST_MS;
    return EXEC_TIMEOUT_NORMAL_MS;
  }
  if (['go', 'mvn', 'gradle', 'make', 'cmake', 'dotnet', 'swift'].includes(c)) {
    if (/(build|install|package|release|assemble)/.test(joined)) return EXEC_TIMEOUT_BUILD_MS;
    return EXEC_TIMEOUT_TEST_MS;
  }
  if (['pytest', 'vitest', 'jest', 'tsc', 'eslint', 'prettier', 'ruff', 'mypy'].includes(c)) {
    return EXEC_TIMEOUT_TEST_MS;
  }
  return EXEC_TIMEOUT_NORMAL_MS;
}

function numericTimeout(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return undefined;
}

/**
 * Çağrı timeout'u: açık `timeoutMs` > komut türü varsayılanı; sonra
 * [1 sn, ayar üst sınırı] aralığına kırpılır. Rust tarafı ayrıca 600 sn
 * tavanını uygular (savunma katmanı).
 */
export function resolveExecTimeout(
  call: ToolCall,
  cmd: string,
  args: string[],
  maxTimeoutMs?: number,
): number {
  const upper = Math.max(
    EXEC_TIMEOUT_MIN_MS,
    Math.min(EXEC_TIMEOUT_MAX_MS, maxTimeoutMs ?? EXEC_TIMEOUT_MAX_MS),
  );
  const explicit = numericTimeout(call.args.timeoutMs);
  const chosen = explicit ?? execTimeoutFor(cmd, args);
  return Math.max(EXEC_TIMEOUT_MIN_MS, Math.min(upper, Math.round(chosen)));
}

async function invokeExec(
  args: Record<string, unknown>,
  onStream?: (stream: ExecStream, data: string) => void,
): Promise<ExecOut> {
  if (isTauriRuntime()) {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    const channel = new Channel<ExecEvent>((ev) => {
      if (ev.k === 'stdout') onStream?.('stdout', ev.data);
      else if (ev.k === 'stderr') onStream?.('stderr', ev.data);
    });
    return invoke<ExecOut>('exec_cmd_stream', { ...args, onEvent: channel });
  }
  throw new Error(`exec_cmd_stream yalnızca Tauri'de çalışır`);
}

/** Çalışan bir exec'i iptal eder (kart üzerindeki durdur düğmesi). */
export async function cancelExec(runId: string): Promise<boolean> {
  if (!isTauriRuntime() || !runId) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('exec_cancel', { runId });
  } catch {
    return false;
  }
}

function formatExecOut(out: ExecOut): string {
  const tail = out.truncated ? `\n${t('tool.outputTruncated')}` : '';
  const errPart = out.stderr ? `\n[stderr]\n${out.stderr}` : '';
  return `[exit ${out.code}]\n${out.stdout}${errPart}${tail}`;
}

export async function toolExec(
  root: string,
  call: ToolCall,
  mode: ApprovalMode = 'manual',
  opts?: {
    /** Kullanıcı onaylı (resolve yolundan) — yalnızca `createAgentRun.resolve`
     *  bunu true geçirir; başka hiçbir yol exec'i çalıştıramaz. */
    approved?: boolean;
    /** Faz 6: ayarlardan gelen özel allowlist (Rust'a invoke öncesi karara dahil). */
    extraAllow?: Record<string, string[][]>;
    /** P0.2: canlı çıktı parçaları (stdout/stderr). */
    onStream?: (stream: ExecStream, data: string) => void;
    /** P0.2: ayarlardan genel timeout üst sınırı (ms). */
    maxTimeoutMs?: number;
  },
): Promise<string> {
  const d = decideTool('exec', call.args, mode, opts?.extraAllow ?? {});
  if (!d.allowed) throw new Error(d.reason ?? t('tool.forbiddenCommand'));
  if (!d.autoApproved && !opts?.approved) {
    throw new Error(`onay gerekli: ${strArg(call.args, 'cmd')} · /apply ile onayla`);
  }
  const cmd = strArg(call.args, 'cmd', '');
  const rawArgs = Array.isArray(call.args.args)
    ? (call.args.args as unknown[]).filter((a): a is string => typeof a === 'string')
    : [];
  const cwdRel = strArg(call.args, 'cwd', '');
  // M5: Rust tarafı cwd'yi koşulsuz jail'e sokar; burada erken/net hata ver.
  if (cwdRel && !isPathSafe(cwdRel)) {
    throw new Error(t('tool.cwdUnsafe', { cwd: cwdRel }));
  }
  // cwd jail: root + relative.
  const cwd = cwdRel ? `${root}/${cwdRel}` : root;
  // Faz 8 L3: kullanıcı allowlist uzantısı Rust tarafına da gönderilir
  // (TS kapısı geçse bile Rust reddetmesin → özellik uçtan uca çalışsın).
  const extraAllow = opts?.extraAllow ?? {};
  const timeoutMs = resolveExecTimeout(call, cmd, rawArgs, opts?.maxTimeoutMs);
  const out = await invokeExec(
    {
      runId: call.id,
      cmd,
      args: rawArgs,
      cwd,
      timeoutMs,
      root,
      extraAllow,
    },
    opts?.onStream,
  );
  // P0.2: iptal/timeout ve sıfırdan farklı çıkış kodu artık BAŞARISIZDIR.
  // Agent bunu `tool_result ok:false` olarak görür ve düzeltme turu atabilir.
  if (out.cancelled) {
    throw new Error(`${t('tool.execCancelled')}\n${formatExecOut(out)}`);
  }
  if (out.timed_out) {
    throw new Error(`${t('tool.execTimeout')}\n${formatExecOut(out)}`);
  }
  const text = formatExecOut(out);
  if (out.code !== 0) throw new Error(text);
  return text;
}
