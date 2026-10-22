/**
 * Faz E — Shell aracı (onaylı + allowlist'li).
 */
import { strArg } from '../toolspec';
import type { ToolCall } from '../types';
import { decideTool } from '../policy';
import type { ApprovalMode } from '../types';
import { t } from '../../i18n/core';

export interface ExecResult {
  stdout: string;
  code: number;
  truncated: boolean;
}

async function invokeRust<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error(`${cmd} yalnızca Tauri'de çalışır`);
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
  // cwd jail: root + relative.
  const cwd = cwdRel ? `${root}/${cwdRel}` : root;
  // Faz 8 L3: kullanıcı allowlist uzantısı Rust tarafına da gönderilir
  // (TS kapısı geçse bile Rust reddetmesin → özellik uçtan uca çalışsın).
  const extraAllow = opts?.extraAllow ?? {};
  const out = await invokeRust<{ stdout: string; stderr: string; code: number; truncated: boolean }>(
    'exec_cmd',
    { cmd, args: rawArgs, cwd, timeoutMs: 15000, root, extraAllow },
  );
  const tail = out.truncated ? `\n${t('tool.outputTruncated')}` : '';
  const errPart = out.stderr ? `\n[stderr]\n${out.stderr}` : '';
  return `[exit ${out.code}]\n${out.stdout}${errPart}${tail}`;
}
