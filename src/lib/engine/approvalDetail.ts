/**
 * L4 — onay kartında tam argüman görünürlüğü.
 *
 * Eski davranış: `Terminal.tsx` exec dışındaki araçlarda `JSON.stringify(args)`
 * çıktısını 240 karaktere kırpıyordu. Kullanıcı onaylamadan önce yazılacak
 * dosyanın tam içeriğini veya MCP çağrısının tüm argümanlarını göremiyordu.
 *
 * Bu helper araç çağrısını UI'ın gösterebileceği parçalara ayırır:
 * - `summary`: araç adının yanında her zaman görünen tek satır (exec için tam
 *   komut satırı; write/patch için hedef yol).
 * - `body`: onay öncesi incelenmesi gereken **tam** içerik (write/patch
 *   içeriği, diğer araçlarda tam JSON). `null` ise ek gövde yok.
 * - `collapsible`: uzun gövdenin varsayılan olarak kırpılıp kırpılmayacağı.
 *   exec gibi tek satırlık kritik komutlar asla kırpılmaz.
 *
 * Kırpma kararı UI'a aittir; helper hiçbir zaman içeriği kesmez. Böylece
 * "Tümünü göster" her durumda gerçek tam metni ortaya çıkarır.
 */
import type { ToolCall } from './types';

/** Gövde bu uzunluğu aşarsa kartta varsayılan olarak kırpılır ("Tümünü göster"). */
export const APPROVAL_BODY_PREVIEW_CHARS = 800;

/** Bu uzunluğun üzerindeki argümanlar kartta ayrıca uyarıyla işaretlenir. */
export const APPROVAL_LARGE_PAYLOAD_CHARS = 4000;

export interface ApprovalDetail {
  /** Araç adının yanında her zaman görünen tek satır. */
  summary: string;
  /** Tam argüman gövdesi; `null` = gösterilecek ek içerik yok. */
  body: string | null;
  /** `body` karakter sayısı. */
  bodyChars: number;
  /** Uzun gövde varsayılan olarak kırpılsın mı? */
  collapsible: boolean;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string) : '';
}

/** Tam JSON; döngüsel/Serializable olmayan argümanlarda boş string. */
function prettyArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2) ?? '';
  } catch {
    return '';
  }
}

export function formatApprovalDetail(call: ToolCall): ApprovalDetail {
  const name = String(call.name ?? '');
  const args = call.args ?? {};

  if (name === 'exec') {
    const cmd = stringArg(args, 'cmd');
    const list = Array.isArray(args.args)
      ? (args.args as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];
    const line = [cmd, ...list].join(' ').trim();
    // exec onayı tam satır üzerinden verilir; kırpma yok.
    return { summary: line, body: null, bodyChars: line.length, collapsible: false };
  }

  if (name === 'write_file' || name === 'propose_patch') {
    const path = stringArg(args, 'path');
    const content = stringArg(args, 'content');
    // Tam içerik body'de; kart yalnızca görsel olarak kırpar.
    return { summary: path, body: content, bodyChars: content.length, collapsible: true };
  }

  if (name === 'edit_file') {
    const path = stringArg(args, 'path');
    const body = prettyArgs({
      search: stringArg(args, 'search'),
      replace: stringArg(args, 'replace'),
    });
    return { summary: path, body, bodyChars: body.length, collapsible: true };
  }

  // MCP ve diğer araçlar: 240 karakter kırpması kaldırıldı — tam JSON.
  const body = prettyArgs(args);
  return { summary: '', body, bodyChars: body.length, collapsible: true };
}
