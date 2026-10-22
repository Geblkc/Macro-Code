/**
 * Faz 3 — Yeni dosya oluşturma (create-only, O_EXCL).
 * Mevcut dosya hedefi reddedilir (Rust) → Türkçe mesajla iletilir.
 */
import { strArg } from '../toolspec';
import type { ToolCall } from '../types';
import { decideTool } from '../policy';
import { t } from '../../i18n/core';

async function invokeRust<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error(`${cmd} yalnızca Tauri'de çalışır · /root ile workspace seçip masaüstü uygulamada dene`);
}

export async function toolWriteFile(
  root: string,
  call: ToolCall,
  writeImpl?: (root: string, path: string, content: string) => Promise<void>,
): Promise<string> {
  const d = decideTool('write_file', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? t('tool.forbiddenPath'));
  const path = strArg(call.args, 'path', '');
  if (!path) throw new Error('path gerekli');
  if (typeof call.args.content !== 'string') throw new Error('content gerekli');
  const content = call.args.content;
  if (writeImpl) {
    await writeImpl(root, path, content);
  } else {
    await invokeRust('write_file', { root, path, content });
  }
  return `/// oluşturuldu: ${path}`;
}
