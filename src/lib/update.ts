import { APP_VERSION, REPO_URL } from './appInfo';
import { fetchFor } from './providers/rustFetch';
import { isTauri } from './tauri';
import { log } from './logger';
import { t } from './i18n/core';

/**
 * Güncelleme altyapısı.
 *
 * İki yol vardır:
 *
 * 1. **Tauri updater** (`@tauri-apps/plugin-updater`) — imzalı `latest.json`
 *    üzerinden indirir/kurar. Linux'ta yalnızca AppImage, Windows'ta NSIS
 *    paketleri otomatik güncellenebilir.
 * 2. **GitHub Releases API** — tarayıcı geliştirme modunda ve `latest.json`
 *    henüz yayınlanmamışsa (veya updater hata verirse) yedek yol. Yalnızca
 *    bilgi verir; elle güncelleme bağlantısı üretir.
 *
 * Ağ isteği `fetchFor` üzerinden gider: Tauri'de CSP dışındaki hostlar Rust
 * proxy'ye yönlenir (`providers/rustFetch.ts`), bu yüzden `tauri.conf.json`
 * CSP'sine yeni bir host eklemek gerekmez.
 */

export interface UpdateAsset {
  name: string;
  url: string;
  size?: number;
}

export interface UpdateInfo {
  /** Yeni sürüm (baştaki `v` temizlenmiş). */
  version: string;
  /** Uygulamanın mevcut sürümü. */
  currentVersion: string;
  /** Yayın tarihi (ISO/RFC3339, varsa). */
  date?: string;
  /** Sürüm notları (düz metin). */
  notes: string;
  /** GitHub release sayfası. */
  url: string;
  /** Release paketleri (GitHub API yolunda dolar). */
  assets: UpdateAsset[];
  /** Bilginin kaynağı. */
  source: 'updater' | 'github';
}

export interface UpdateSupport {
  /** Otomatik indirme + kurulum destekleniyor mu? */
  supported: boolean;
  /** `appimage` | `package` | `windows` | `macos` | `browser` | `unknown` */
  kind: string;
}

export interface DownloadProgress {
  phase: 'started' | 'progress' | 'finished';
  downloaded: number;
  total: number;
}

/** Günlük otomatik kontrol aralığı (24 saat). */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** GitHub deposu (`owner/repo`) — `REPO_URL`'den türetilir. */
export function repoSlug(repoUrl: string = REPO_URL): string | null {
  const m = /github\.com[/:]([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i.exec(repoUrl.trim());
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

const SLUG = repoSlug();

/** Son sürümü döndüren GitHub API adresi (yoksa boş string). */
export const GITHUB_API_LATEST = SLUG
  ? `https://api.github.com/repos/${SLUG}/releases/latest`
  : '';

/** Sürüme özel GitHub release sayfası (bilinmiyorsa genel releases sayfası). */
export function releasePageUrl(version?: string): string {
  if (!SLUG) return '';
  const base = `https://github.com/${SLUG}/releases`;
  const v = version ? normalizeVersion(version) : '';
  return v ? `${base}/tag/v${v}` : base;
}

/** Baştaki `v`/`V` ve boşlukları temizler. */
export function normalizeVersion(raw: string): string {
  return raw.trim().replace(/^v/i, '');
}

interface ParsedVersion {
  core: number[];
  pre: string[];
}

/** Semver benzeri ayrıştırma; geçersizse `null`. */
export function parseVersion(raw: string): ParsedVersion | null {
  const v = normalizeVersion(raw);
  if (!v) return null;
  const [corePart, ...preParts] = v.split('-');
  if (!corePart) return null;
  const core = corePart.split('.');
  if (core.length === 0 || core.some((p) => !/^\d+$/.test(p))) return null;
  const pre = preParts.join('-').split('.').filter(Boolean);
  return { core: core.map((n) => Number.parseInt(n, 10)), pre };
}

/**
 * `a` sürümü `b` sürümünden yeni mi?
 * Semver kuralı: prerelease sürüm normal sürümden küçüktür.
 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  const len = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa.core[i] ?? 0;
    const y = pb.core[i] ?? 0;
    if (x !== y) return x > y;
  }
  // Çekirdek eşit: prerelease'i olmayan daha yenidir.
  if (pa.pre.length === 0 && pb.pre.length === 0) return false;
  if (pa.pre.length === 0) return true;
  if (pb.pre.length === 0) return false;
  const plen = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < plen; i += 1) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return false;
    if (y === undefined) return true;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d > 0;
    } else if (nx !== ny) {
      // Sayısal tanımlayıcı, alfanümerik olandan küçüktür.
      return nx;
    } else if (x !== y) {
      return x > y;
    }
  }
  return false;
}

/** Günlük kontrol zamanı geldi mi? */
export function shouldCheckNow(
  lastCheck: number,
  now: number = Date.now(),
  interval: number = UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(lastCheck) || lastCheck <= 0) return true;
  return now - lastCheck >= interval;
}

/** Kullanıcı bu sürümü yok saydıysa açılış bildirimi gösterilmez. */
export function shouldNotify(version: string, ignoredVersion: string): boolean {
  return normalizeVersion(version) !== normalizeVersion(ignoredVersion || '');
}

/** Platform adı (asset seçimi için). */
export function currentPlatform(): 'linux' | 'windows' | 'macos' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macos';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

/**
 * Platforma uygun paketi seçer.
 * Sıra önemlidir: Linux'ta AppImage otomatik güncellenebildiği için ilk sırada.
 */
export function pickAsset(
  assets: UpdateAsset[],
  platform: 'linux' | 'windows' | 'macos' | 'unknown' = currentPlatform(),
): UpdateAsset | null {
  const lower = (s: string) => s.toLowerCase();
  // Öncelik sırası korunur: önce ilk uzantı aranır, bulunamazsa sonrakine
  // geçilir. (Ters mantık, listede önce gelen .deb'i AppImage'den önce seçerdi.)
  const find = (...needles: string[]) => {
    for (const n of needles) {
      const hit = assets.find((a) => lower(a.name).endsWith(n));
      if (hit) return hit;
    }
    return null;
  };
  if (platform === 'windows') {
    return find('.exe', '.msi');
  }
  if (platform === 'linux') {
    return find('.appimage', '.deb', '.rpm');
  }
  if (platform === 'macos') {
    return find('.dmg', '.tar.gz');
  }
  return null;
}

/** GitHub release JSON'unu `UpdateInfo`'ya çevirir; geçersizse `null`. */
export function parseGitHubRelease(raw: unknown, currentVersion = APP_VERSION): UpdateInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  const version = normalizeVersion(tag);
  if (!parseVersion(version)) return null;
  const assets: UpdateAsset[] = Array.isArray(r.assets)
    ? (r.assets as unknown[])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .map((a) => ({
          name: typeof a.name === 'string' ? a.name : '',
          url: typeof a.browser_download_url === 'string' ? a.browser_download_url : '',
          ...(typeof a.size === 'number' ? { size: a.size } : {}),
        }))
        .filter((a) => a.name && a.url)
    : [];
  const url = typeof r.html_url === 'string' && r.html_url ? r.html_url : releasePageUrl(version);
  const notes = typeof r.body === 'string' ? r.body : '';
  const date = typeof r.published_at === 'string' ? r.published_at : undefined;
  return {
    version,
    currentVersion,
    ...(date ? { date } : {}),
    notes,
    url,
    assets,
    source: 'github',
  };
}

/** GitHub Releases API'den son sürümü çeker. */
export async function fetchLatestRelease(fetchImpl?: typeof fetch): Promise<UpdateInfo> {
  if (!GITHUB_API_LATEST) throw new Error(t('update.noRepo'));
  const doFetch = fetchFor(GITHUB_API_LATEST, fetchImpl);
  const res = await doFetch(GITHUB_API_LATEST, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'MacroCode',
    },
  });
  if (!res.ok) {
    throw new Error(t('update.fetchFailed', { status: res.status }));
  }
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error(t('update.invalidResponse'));
  }
  const parsed = parseGitHubRelease(raw);
  if (!parsed) throw new Error(t('update.invalidResponse'));
  return parsed;
}

export interface CheckOptions {
  /** Test enjeksiyonu. */
  fetchImpl?: typeof fetch;
  /** `false` ise Tauri updater hatasında GitHub API'ye düşülmez. */
  githubFallback?: boolean;
}

/**
 * Güncelleme kontrolü.
 *
 * - Güncelse `null` döner.
 * - Yeni sürüm varsa `UpdateInfo`.
 * - Ağ/updater hatasında `Error` fırlatır (çağıran kullanıcıya gösterir).
 */
export async function checkForUpdate(options: CheckOptions = {}): Promise<UpdateInfo | null> {
  const githubFallback = options.githubFallback !== false;

  if (isTauri()) {
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 30_000 });
      if (!update) return null;
      const version = normalizeVersion(update.version);
      if (!isNewerVersion(version, APP_VERSION)) return null;
      return {
        version,
        currentVersion: update.currentVersion || APP_VERSION,
        ...(update.date ? { date: update.date } : {}),
        notes: typeof update.body === 'string' ? update.body : '',
        url: releasePageUrl(version),
        assets: [],
        source: 'updater',
      };
    } catch (e) {
      log('warn', 'update.updaterCheckFailed', {
        message: e instanceof Error ? e.message : String(e),
      });
      if (!githubFallback) throw e;
    }
  }

  // GitHub API yolu (tarayıcı dev veya updater fallback).
  const latest = await fetchLatestRelease(options.fetchImpl);
  return isNewerVersion(latest.version, APP_VERSION) ? latest : null;
}

/**
 * Otomatik kurulumun desteklenip desteklenmediğini sorar (Rust `update_support`).
 * Tarayıcı geliştirme modunda daima desteklenmez.
 */
export async function updateSupport(): Promise<UpdateSupport> {
  if (!isTauri()) return { supported: false, kind: 'browser' };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<UpdateSupport>('update_support');
  } catch (e) {
    log('warn', 'update.supportFailed', {
      message: e instanceof Error ? e.message : String(e),
    });
    return { supported: false, kind: 'unknown' };
  }
}

/**
 * Güncellemeyi indirir, kurar ve uygulamayı yeniden başlatır.
 *
 * Windows'ta Tauri kurulum sırasında uygulamayı kendisi kapatır; bu yüzden
 * `relaunch()` çağrısına ulaşılamayabilir.
 */
export async function downloadAndInstallUpdate(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (!isTauri()) throw new Error(t('update.tauriOnly'));
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check({ timeout: 30_000 });
  if (!update) throw new Error(t('update.notFound'));
  let total = 0;
  let downloaded = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        onProgress?.({ phase: 'started', downloaded, total });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ phase: 'progress', downloaded, total });
        break;
      case 'Finished':
        onProgress?.({ phase: 'finished', downloaded, total });
        break;
      default:
        break;
    }
  });
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** Release sayfasını sistem tarayıcısında açar (elle güncelleme). */
export async function openReleasePage(url?: string): Promise<void> {
  const target = url || releasePageUrl();
  if (!target) throw new Error(t('update.noRepo'));
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(target);
    return;
  }
  const opened = window.open(target, '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error(t('update.openFailed'));
}

/** İndirme yüzdesi (0-100); toplam bilinmiyorsa -1. */
export function downloadPercent(p: DownloadProgress): number {
  if (!p.total || p.total <= 0) return -1;
  return Math.min(100, Math.max(0, Math.round((p.downloaded / p.total) * 100)));
}

/** Bayt → insan okunur boyut. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded =
    i === 0 || value >= 10 || Number.isInteger(value)
      ? Math.round(value)
      : value.toFixed(1);
  return `${rounded} ${units[i]}`;
}

/** Sürüm notlarını terminal satırına sığacak şekilde kısaltır. */
export function compactNotes(notes: string, max = 280): string {
  const clean = notes
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' · ');
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}
