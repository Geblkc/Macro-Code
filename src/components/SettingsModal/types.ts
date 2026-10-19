import type { CustomEndpoint, CustomModel, ModelParams, ModelPrice, Provider } from '../../types';
import type { IconName } from '../icons';

export type TabId = 'providers' | 'models' | 'chat' | 'mcp' | 'lang' | 'about';

export const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'providers', label: 'Sağlayıcılar', icon: 'key' },
  { id: 'models', label: 'Modeller', icon: 'cpu' },
  { id: 'chat', label: 'Sohbet', icon: 'message' },
  { id: 'mcp', label: 'MCP', icon: 'activity' },
  { id: 'lang', label: 'Dil ve bölge', icon: 'globe' },
  { id: 'about', label: 'Hakkında', icon: 'info' },
];

/** Bağlantı testi durumu: beklemede / testte / bağlı / geçersiz / ağ hatası. */
export type TestConn = 'idle' | 'testing' | 'ok' | 'invalid' | 'network';

export const TEST_CONN_LABEL: Record<TestConn, string> = {
  idle: '',
  testing: 'test ediliyor…',
  ok: 'bağlı ✓',
  invalid: 'geçersiz',
  network: 'ağ hatası',
};

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
