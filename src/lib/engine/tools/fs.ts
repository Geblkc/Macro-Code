/**
 * Faz C — FS araçları (Tauri invoke wrapper).
 * Tarayıcı-dev'de Rust yoksa açıklayıcı hata döner.
 */
import { strArg } from '../toolspec';
import type { ToolCall } from '../types';
import { decideTool } from '../policy';
import { t } from '../../i18n/core';

export interface DirEntry {
  name: string;
  is_dir: boolean;
}

async function invokeRust<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error(`${cmd} yalnızca Tauri'de çalışır · /root ile workspace seçip masaüstü uygulamada dene`);
}

export async function toolListDir(root: string, call: ToolCall): Promise<string> {
  const d = decideTool('list_dir', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? t('tool.forbiddenPath'));
  const path = strArg(call.args, 'path', '');
  const entries = await invokeRust<DirEntry[]>('list_dir', { root, path });
  if (entries.length === 0) return t('tool.emptyDir');
  return entries.map((e) => `${e.is_dir ? 'dir  ' : 'file '} ${e.name}`).join('\n');
}

export async function toolReadFile(root: string, call: ToolCall): Promise<string> {
  const d = decideTool('read_file', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? t('tool.forbiddenPath'));
  const path = strArg(call.args, 'path', '');
  if (!path) throw new Error('path gerekli');
  const limitRaw = call.args.limit;
  const limit = typeof limitRaw === 'number' ? Math.floor(limitRaw) : 200;
  const offsetRaw = call.args.offset;
  const offset = typeof offsetRaw === 'number' && Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : null;
  const out = await invokeRust<{ content: string; truncated: boolean }>('read_file', {
    root,
    path,
    limit,
    ...(offset !== null ? { offset } : {}),
  });
  return out.truncated ? `${out.content}\n…[devamı kesildi]` : out.content;
}

export async function toolGrep(root: string, call: ToolCall): Promise<string> {
  const d = decideTool('grep', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? t('tool.forbiddenPath'));
  const pattern = strArg(call.args, 'pattern', '');
  if (!pattern) throw new Error('pattern gerekli');
  const path = strArg(call.args, 'path', '');
  const regex = call.args.regex === true;
  const hits = await invokeRust<Array<{ path: string; line: number; text: string }>>('grep_files', {
    root,
    pattern,
    path: path || null,
    ...(regex ? { regex: true } : {}),
  });
  if (hits.length === 0) return t('tool.noMatch');
  return hits.map((h) => `${h.path}:${h.line}: ${h.text}`).join('\n');
}

export async function toolGlob(root: string, call: ToolCall): Promise<string> {
  const d = decideTool('glob', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? t('tool.forbiddenPath'));
  const pattern = strArg(call.args, 'pattern', '');
  if (!pattern) throw new Error('pattern gerekli');
  const path = strArg(call.args, 'path', '');
  const hits = await invokeRust<DirEntry[]>('glob_files', {
    root,
    pattern,
    path: path || null,
  });
  if (hits.length === 0) return t('tool.noMatch');
  return hits.map((e) => `${e.is_dir ? 'dir  ' : 'file '} ${e.name}`).join('\n');
}

export async function runFsTool(root: string, call: ToolCall): Promise<string> {
  if (call.name === 'list_dir') return toolListDir(root, call);
  if (call.name === 'read_file') return toolReadFile(root, call);
  if (call.name === 'grep') return toolGrep(root, call);
  if (call.name === 'glob') return toolGlob(root, call);
  throw new Error(`bilinmeyen fs aracı: ${call.name}`);
}
