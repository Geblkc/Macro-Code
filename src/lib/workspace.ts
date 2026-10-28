/**
 * Proje klasörü (workspace) seçme altyapısı — saf çekirdek + Tauri köprüsü.
 *
 * Katmanlar:
 *  - SAF fonksiyonlar (normalizeRoot/labelOfRoot/rootForbidCode/validateRootInput)
 *    → vitest ile test edilir, agent'a/i18n bağımlılığı yoktur.
 *  - `pickWorkspaceFolder()` → tauri-plugin-dialog `open({directory:true})`
 *    köprüsü. Tarayıcı-dev'de null döner (mevcut `/files` TauriOnly deseni).
 *  - `checkRootExists()` → mevcut Rust `list_dir` komutuyla var/dizin kontrolü
 *    (yeni Rust komutu eklemek yerine jail'in olduğu tek doğruluk kaynağı).
 *
 * Güvenlik notu: buradaki reddetmeler **UX hatası düşürmek** içindir (klasör
 * seçme anında); asıl sandbox hâlâ Rust `fs.rs` jail'i + `policy.ts` çift
 * savunmasıdır ve bu modül onları hiçbir şekilde gevşetmez.
 */
import { invoke } from '@tauri-apps/api/core';
import type { TranslationKey } from './i18n/core';
import { isTauri } from './tauri';

/**
 * Workspace kökü olarak ASLA seçilemeyecek yollar.
 *  - Dosya sistemi kökleri (`/`, Windows sürücüleri, `..` bitenler)
 *  - Home'un kendisi ve bilinen hassas yapılandırma dizinleri
 * (ad-bileşeni bazlı; blocks.json `dirs`=["node_modules", ".git", …] buraya
 * girmez — böyle adlı meşru projelere bulaşmaz.)
 */
export const FORBIDDEN_ROOT_SEGS: ReadonlySet<string> = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.kube',
  '.docker',
  'appdata',
  'system32',
  'windows',
  'etc',
  'proc',
  'sys',
  'dev',
]);

/** normalizeRoot: ters eğik çizgi → düz eğik, sondaki ayraç siler, trim. */
export function normalizeRoot(raw: string): string {
  const p = raw.trim().replace(/\\/g, '/');
  if (!p || p === '/') return p;
  return p.replace(/\/+$/, '');
}

/** Görünen ad: yolun son bileşeni; boşlukta yolun kendisi. */
export function labelOfRoot(root: string): string {
  const p = normalizeRoot(root);
  const last = p.split('/').filter(Boolean).pop();
  return last || p;
}

/**
 * Workspace kökü seçilemez mi? SAF — varlık kontrolü yapmaz (o async).
 * Reddetme kodları: 'empty' | 'relative' | 'root' | 'home' | 'sensitive'
 * (döndürülen string i18n anahtar kodudur — düz metin taşımaz).
 */
const SYSTEM_ROOT_DIRS: ReadonlySet<string> = new Set([
  'etc',
  'proc',
  'sys',
  'dev',
  'run',
  'boot',
  'windows',
  'system32',
]);

export function rootForbidCode(raw: string): string | null {
  const p = normalizeRoot(raw);
  if (!p) return 'empty';
  // Mutlaklık: unix ('/') veya windows ('C:/'). Windows sürücüleri de kabul.
  const hasDrive = /^[a-zA-Z]:[\\/]/.test(raw.trim());
  const unc = /^\/\/[^/]+/.test(p);
  if (!p.startsWith('/') && !hasDrive && !unc) return 'relative';
  const segs = p.split('/').filter(Boolean);
  // Çıplak dosya sistemi kökü: '/' veya 'C:' (sürücü harfi tek başına).
  if (segs.length === 0) return 'root';
  if (segs.length === 1 && /^[a-zA-Z]:$/.test(segs[0]!)) return 'root';
  // Sürücü bileşeni ayrıştır: 'C:/Windows' → first='windows', depth=1.
  const driveRoot = /^[a-zA-Z]:$/.test(segs[0]!);
  const first = (driveRoot ? segs[1]! : segs[0]!).toLowerCase();
  const depth = driveRoot ? segs.length - 1 : segs.length;
  if (depth === 1 && SYSTEM_ROOT_DIRS.has(first)) return 'root';
  // Home bütünüyle: /home/<k> · /Users/<k> · C:/Users/<k> — proje klasörü seç.
  if ((first === 'home' || first === 'users') && depth === 2) return 'home';
  // ~.ssh gibi hassas adlar en derin bileşende bile reddedilir:
  if (segs.some((s) => FORBIDDEN_ROOT_SEGS.has(s.toLowerCase()))) return 'sensitive';
  return null;
}

/** Okunabilir mesaj üretimi için i18n anahtar eşlemesi (code → workspace.forbid.*). */
export function rootForbidKey(code: string | null): TranslationKey | null {
  if (!code) return null;
  return `workspace.forbid.${code}` as TranslationKey;
}

/**
 * Manuel `/root <yol>` girişini doğrula (SAF).
 * Dönüş: { ok: true, root, label } | { ok: false, key }
 * (key = i18n anahtarı; hata çıkarmaz — App katmanı pushExtra yapar.)
 */
export function validateRootInput(
  raw: string,
): { ok: true; root: string; label: string } | { ok: false; key: TranslationKey } {
  const code = rootForbidCode(raw);
  if (code) return { ok: false, key: rootForbidKey(code)! };
  const root = normalizeRoot(raw);
  return { ok: true, root, label: labelOfRoot(root) };
}

/**
 * Rust `list_dir` ile kök varlık/dizinlik kontrolü.
 * klasör yoksa veya dizin değilse (dosya) `list_dir` hata döner → false.
 * Yalnızca Tauri'de çalışır; tarayıcı-dev'de kontrolsüz geçer (dev kolaylığı).
 */
export async function checkRootExists(root: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    const entries = await invoke<Array<{ name: string; is_dir: boolean }>>('list_dir', {
      root,
      path: '',
    });
    return Array.isArray(entries);
  } catch {
    return false;
  }
}

/**
 * Yerel klasör diyaloğu (tauri-plugin-dialog). Seçim yok → null.
 * Plugin yüklü değilse (eski build) TypeError'a düşer → null + konsol uyarısı.
 */
export async function pickWorkspaceFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const mod = await import('@tauri-apps/plugin-dialog');
    const picked = await mod.open({ directory: true, multiple: false, title: 'MacroCode' });
    if (typeof picked !== 'string') return null;
    return normalizeRoot(picked);
  } catch (e) {
    // Plugin yok (eski build) / portal erişimi yok — iptalle aynı: null.
    console.warn('[workspace] klasör diyaloğu açılamadı', e);
    return null;
  }
}
