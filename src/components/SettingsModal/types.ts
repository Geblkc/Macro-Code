import type { CustomEndpoint, CustomModel, ModelParams, ModelPrice, Provider } from '../../types';
import type { IconName } from '../icons';
import type { TranslationKey } from '../../lib/i18n/locales/tr';
import type { LanguageSetting } from '../../lib/i18n/types';
import { parseCustomLine } from '../../lib/engine/policy';

export { nextTabIndex } from '../../lib/tabNav';

export type TabId =
  | 'providers'
  | 'models'
  | 'params'
  | 'chat'
  | 'appearance'
  | 'mcp'
  | 'about';

/** Bağlantı testi durumu: beklemede / testte / bağlı / geçersiz / ağ hatası. */
export type TestConn = 'idle' | 'testing' | 'ok' | 'invalid' | 'network';

export const TABS: { id: TabId; labelKey: TranslationKey; icon: IconName }[] = [
  { id: 'providers', labelKey: 'settings.tab.providers', icon: 'key' },
  { id: 'models', labelKey: 'settings.tab.models', icon: 'cpu' },
  { id: 'params', labelKey: 'settings.tab.params', icon: 'sliders' },
  { id: 'chat', labelKey: 'settings.tab.chat', icon: 'message' },
  { id: 'appearance', labelKey: 'settings.tab.appearance', icon: 'globe' },
  { id: 'mcp', labelKey: 'settings.tab.mcp', icon: 'activity' },
  { id: 'about', labelKey: 'settings.tab.about', icon: 'info' },
];

/**
 * Maskeli secret alanı durumu.
 * - `value`: kullanıcının yazdığı YENİ değer (boş = dokunulmadı).
 * - `hint`: `key_hint` sonucu (`••••a1b2`) veya boş (kayıt yok).
 * - `deleted`: sil düğmesine basıldı (Kaydet'te keystore'dan silinir).
 */
export interface SecretDraft {
  value: string;
  hint: string;
  deleted: boolean;
}

/** Özel uç kartı taslağı (`key`: liste anahtarı, `id`: kayıtlı uç id'si, yenide ''). */
export interface CustomDraft {
  key: string;
  id: string;
  isNew: boolean;
  name: string;
  baseUrl: string;
  modelsText: string;
  secret: SecretDraft;
  removed: boolean;
}

/** MCP sunucu kartı taslağı (`key`: liste anahtarı, `id`: kayıtlı id, yenide ''). */
export interface McpDraft {
  key: string;
  id: string;
  isNew: boolean;
  name: string;
  transport: 'http' | 'stdio';
  url: string;
  command: string;
  argsText: string;
  /** `ANAHTAR=değer` satırları (değerler keystore'a, adlar ayara). */
  envText: string;
  enabled: boolean;
  /** Virgülle ayrılmış araç adları (boş = tümü). */
  allowedText: string;
  removed: boolean;
}

export interface Draft {
  /** Anahtar: provider id veya `custom_<slug>` (Ollama URL'si hariç — o düz alan). */
  secrets: Record<string, SecretDraft>;
  ollamaUrl: string;
  baseUrlOverride: Partial<Record<Provider, string>>;
  customs: CustomDraft[];
  activeEndpointId: string | null;
  currentModel: string;
  customModels: CustomModel[];
  disabledModels: string[];
  modelParams: Record<string, ModelParams>;
  fallbackModel: string;
  prices: Record<string, ModelPrice>;
  systemPrompt: string;
  fontSize: number;
  summarizerProvider: Provider | '';
  summarizerModel: string;
  showThinking: boolean;
  /** Faz 11: prompt önbelleği. */
  cachePrompts: boolean;
  mcps: McpDraft[];
  customAllowList: string[];
  auditEnabled: boolean;
  /** Görünüm: yüksek kontrast paleti. */
  contrast: 'normal' | 'high';
  /** Görünüm: arayüz kabuğu fontu. */
  uiFont: 'mono' | 'inter';
  /** Görünüm: saat biçimi. */
  clockFormat: '24h' | '12h';
  /** Görünüm: terminalde zaman damgası gösterilsin mi. */
  showTimestamps: boolean;
  /** Arayüz dili: 'auto' = sistem diline göre çözülür. */
  language: LanguageSetting;
}

/** Keşfedilen MCP aracı (ad + kısa açıklama). */
export interface McpToolInfo {
  name: string;
  description?: string;
}

/** MCP keşif sonucu (ayar ekranı). */
export interface McpDiscovery {
  count: number;
  error: string | null;
  busy: boolean;
  /** Keşfedilen araçlar (listeden izin seçimi için). */
  tools: McpToolInfo[];
}

/** `ANAHTAR=değer` metnini kayda çevirir (boş/geçersiz satırlar atlanır). */
export function parseEnvText(text: string): { keys: string[]; values: Record<string, string> } {
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!k || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    values[k] = v;
  }
  return { keys: Object.keys(values), values };
}

/** Kayıtlı env adlarını + bellek değerlerini metne çevirir. */
export function serializeEnv(keys: string[], values: Record<string, string>): string {
  return keys.map((k) => `${k}=${values[k] ?? ''}`).join('\n');
}

/**
 * Shell allowlist'teki **geçersiz satırları** döndürür.
 *
 * Kural motorla aynıdır (`engine/policy.ts` → `parseCustomLine`): `rm`,
 * yorum satırları ve geçersiz komut adları yok sayılır. Boş satırlar
 * sorun değildir.
 */
export function allowListIssues(lines: string[]): string[] {
  const bad: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!parseCustomLine(line)) bad.push(trimmed);
  }
  return bad;
}

/**
 * `ANAHTAR=değer` metninde **değerleri gizler** (anahtar adları korunur).
 * Secret'lar ekranda düz metin görünmesin diye kullanılır.
 */
export function maskEnvText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return line;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!key || !value) return line;
      return `${key}=${'•'.repeat(Math.min(8, value.length))}`;
    })
    .join('\n');
}

/**
 * Sekme rayında klavye navigasyonu.
 *
 * ↑↓ / ←→ bir sonraki/önceki sekmeye, `Home` başa, `End` sona gider.
 * İş yoksa `-1` döner (ör. `Tab`, `Enter` gibi tuşlar).
 *
 * Uygulama: `src/lib/tabNav.ts` (hem sekme rayı hem segmented kontrol kullanır).
 */

/** Ziyaret edilen sekme listesine yeni bir sekme ekler (tekrar eklemez). */
export function mergeVisited(visited: TabId[], id: TabId): TabId[] {
  return visited.includes(id) ? visited : [...visited, id];
}

export function emptySecret(): SecretDraft {
  return { value: '', hint: '', deleted: false };
}

/** Tarayıcı-dev ipucu: bellekten son 4 haneyi maskeler (Tauri'de `key_hint` kullanılır). */
export function maskLast4(key: string): string {
  const t = key.trim();
  if (!t) return '';
  if (t.length <= 4) return '••••';
  return `••••${t.slice(-4)}`;
}

/** Kaydet sonrası bu alanda anahtar VAR sayılır mı (girdi veya ipucu, silinmedikçe). */
export function secretHasValue(s: SecretDraft): boolean {
  return !s.deleted && (s.value.trim().length > 0 || s.hint.length > 0);
}

export type { CustomEndpoint };
