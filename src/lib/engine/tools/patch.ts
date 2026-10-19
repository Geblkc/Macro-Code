/**
 * Faz D — Güvenli yazma: önizleme + onaylı uygulama.
 * Doğrudan overwrite API'si yok; akış: propose -> preview -> approve -> apply.
 */
import { strArg } from '../toolspec';
import type { PendingPatch, ToolCall } from '../types';
import { createToolCallId } from '../types';
import { decideTool } from '../policy';

const pending = new Map<string, PendingPatch>();

/** Basit satır diff'i: ortak prefix/suffix kırp, ortayı -/+ olarak göster. */
export function makePreview(path: string, oldText: string, newText: string): string {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (
    suf < a.length - pre &&
    suf < b.length - pre &&
    a[a.length - 1 - suf] === b[b.length - 1 - suf]
  ) {
    suf++;
  }
  const rem = a.slice(pre, a.length - suf);
  const add = b.slice(pre, b.length - suf);
  const head = [`--- ${path} (önizleme)`, `@@ -${pre + 1},${rem.length} +${pre + 1},${add.length} @@`];
  const show = (lines: string[], sign: string) =>
    lines.slice(0, 40).map((l) => `${sign} ${l.slice(0, 240)}`);
  const out = [...head, ...show(rem, '-'), ...show(add, '+')];
  if (rem.length > 40 || add.length > 40) out.push('…[diff kesildi]');
  if (rem.length === 0 && add.length === 0) out.push('(değişiklik yok)');
  return out.join('\n');
}

export function proposePatch(
  path: string,
  newContent: string,
  oldContent = '',
  root = '',
): PendingPatch {
  const p: PendingPatch = {
    id: createToolCallId(),
    path,
    content: newContent,
    preview: makePreview(path, oldContent, newContent),
    createdAt: Date.now(),
    ...(root ? { root } : {}),
  };
  pending.set(p.id, p);
  // Bellek şişmesin: en fazla 10 bekleyen.
  while (pending.size > 10) {
    const first = pending.keys().next().value;
    if (!first) break;
    pending.delete(first);
  }
  return p;
}

export function listPending(): PendingPatch[] {
  return [...pending.values()];
}

export function takePending(id: string): PendingPatch | undefined {
  const p = pending.get(id);
  if (p) pending.delete(id);
  return p;
}

export function clearPending(): void {
  pending.clear();
}

async function invokeRust<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(cmd, args);
  }
  throw new Error(`${cmd} yalnızca Tauri'de çalışır`);
}

/** Tool çağrısı: sadece önizleme üretir, dosyaya dokunmaz. */
export async function toolProposePatch(
  root: string,
  call: ToolCall,
  readOld?: (path: string) => Promise<string>,
): Promise<string> {
  const d = decideTool('propose_patch', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? 'yasaklı yol');
  const path = strArg(call.args, 'path', '');
  const content = typeof call.args.content === 'string' ? call.args.content : '';
  if (!path || !content) throw new Error('path ve content gerekli');
  let old = '';
  if (readOld) {
    try {
      old = await readOld(path);
    } catch {
      old = '';
    }
  } else if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const out = await invokeRust<{ content: string }>('read_file', { root, path, limit: 1000 });
      old = out.content;
    } catch {
      old = '';
    }
  }
  const p = proposePatch(path, content, old, root);
  return `${p.preview}\n\n/// onay için: /apply ${p.id}`;
}

/** Blok bazlı düzenleme tool çağrısı (search_replace). */
export async function toolEditFile(
  root: string,
  call: ToolCall,
  readOld?: (path: string) => Promise<string>,
): Promise<string> {
  const d = decideTool('edit_file', call.args, 'manual');
  if (!d.allowed) throw new Error(d.reason ?? 'yasaklı yol');
  const path = strArg(call.args, 'path', '');
  const search = typeof call.args.search === 'string' ? call.args.search : '';
  const replace = typeof call.args.replace === 'string' ? call.args.replace : '';
  if (!path || !search) throw new Error('path ve search gerekli');

  let old = '';
  if (readOld) {
    try {
      old = await readOld(path);
    } catch {
      old = '';
    }
  } else if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    try {
      const out = await invokeRust<{ content: string }>('read_file', { root, path, limit: 2000 });
      old = out.content;
    } catch {
      old = '';
    }
  }

  if (!old) {
    throw new Error(`dosya okunamadı veya boş: ${path}`);
  }

  const occurrences = old.split(search).length - 1;
  if (occurrences === 0) {
    throw new Error(`aranılan kod bloğu ${path} içinde bulunamadı. Lütfen read_file ile güncel içeriği kontrol et.`);
  }
  if (occurrences > 1) {
    throw new Error(
      `aranılan kod bloğu ${path} içinde birden fazla kez (${occurrences}) geçiyor. Daha fazla çevreleyen satır ekleyerek tekilleştir.`,
    );
  }

  const newContent = old.replace(search, replace);
  const p = proposePatch(path, newContent, old, root);
  return `${p.preview}\n\n/// onay için: /apply ${p.id}`;
}

/** Onaylanmış patch'i uygular (tek kullanımlık id). */
export async function applyPendingPatch(root: string, id: string): Promise<string> {
  const p = takePending(id);
  if (!p) throw new Error(`bekleyen yama bulunamadı: ${id}`);
  // Faz 10 (D2a): yama başka bir workspace'te üretilmişse uygulanmaz.
  // (Aynı göreli yol yeni kökte farklı bir dosyayı ezebilirdi.)
  if (p.root && root && p.root !== root) {
    throw new Error(
      `yama farklı workspace için: ${p.root} ≠ ${root} · /root değişti, yama iptal`,
    );
  }
  await invokeRust('apply_patch', { root, path: p.path, content: p.content });
  return `/// uygulandı: ${p.path}`;
}

/** Son veya belirtilen yamayı geri alır. */
export async function undoLastPatch(root: string, backupId?: string): Promise<string> {
  return invokeRust<string>('undo_patch', { root, backupId: backupId || null });
}
