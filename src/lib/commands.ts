import {
  isKnownModel,
  PROVIDER_IDS,
  getCapabilitiesForModel,
  getProviderForModel,
  migrateProviderModel,
  resolveModels,
  suggestProvider,
} from './providers';
import { sessionCost, formatCost } from './pricing';
import type { CustomModel, LineType, Message, ModelPrice, Provider, Session } from '../types';

export interface CommandLine {
  type: LineType;
  content: string;
}

export interface CommandContext {
  getSession: () => Session | null;
  provider: () => Provider;
  model: () => string;
  createSession: () => void;
  clearView: () => void;
  resetSession: () => void;
  setProvider: (p: Provider) => void;
  setModel: (id: string) => void;
  setSystemPrompt: (text: string) => void;
  openSettings: () => void;
  /** Elle eklenen modeller (yoksa registry listesi kullanılır). */
  customModels?: () => CustomModel[];
  /** 1M token/USD fiyat tablosu (yoksa maliyet satırı çıkmaz). */
  prices?: () => Record<string, ModelPrice>;
  /**
   * Sağlayıcının API anahtarı var mı (yoksa modelleri listelenmez).
   * Verilmezse tüm sağlayıcılar görünür sayılır.
   */
  providerHasKey?: (p: Provider) => boolean;
}

export interface CommandResult {
  handled: boolean;
  lines: CommandLine[];
  /** /export icin uretilen dosya icerigi; indirme isini App yapar. */
  exportText?: string;
  exportFilename?: string;
  exportMime?: string;
}

const VALID_PROVIDERS: Provider[] = [...PROVIDER_IDS];

const HELP_LINES: CommandLine[] = [
  { type: 'sys', content: '/// komutlar:' },
  { type: 'sys', content: '  /help          tum komutlari listele' },
  { type: 'sys', content: '  /clear         terminal ciktisini temizle' },
  { type: 'sys', content: '  /reset         konusma gecmisini sifirla' },
  { type: 'sys', content: '  /session       yeni session baslat' },
  { type: 'sys', content: '  /model <id>    model degistir (orn: /model gpt-6.1-sol)' },
  { type: 'sys', content: `  /provider <p>  saglayici degistir (${PROVIDER_IDS.join('/')})` },
  { type: 'sys', content: '  /key           ayarlari ac' },
  { type: 'sys', content: '  /export [md|json] session\'i disa aktar (varsayilan md)' },
  { type: 'sys', content: '  /backup        session\'i JSON yedegi olarak indir' },
  { type: 'sys', content: '  /tokens        token kullanimini goster (gercek + yaklasik)' },
  { type: 'sys', content: '  /compact        baglamı ozetle (otomatik %75 + elle)' },
  { type: 'sys', content: '  /system <text> system prompt degistir' },
  { type: 'sys', content: '  /root <yol>    workspace sec (agent modu acar)' },
  { type: 'sys', content: '  /files         workspace dosya ozeti' },
  { type: 'sys', content: '  /apply <id>    bekleyen yamayi onayla-uygula' },
  { type: 'sys', content: '  /undo [id]     son veya belirtilen yamayi geri al' },
  { type: 'sys', content: '  /skill         kayitli skill listesi' },
  { type: 'sys', content: '  /approval [m]  onay modu (manual|auto-read|auto-edit)' },
  { type: 'sys', content: '                  manual=yazma onaylı · auto-read=salt-okunur · auto-edit=yazma onaysız' },
  { type: 'sys', content: '  /context        agent\'in bildigi proje baglamini goster' },
  { type: 'sys', content: '  /note <not>     kalici proje notu ekle (sonraki oturumlarda hatirlanir)' },
  { type: 'sys', content: '  /log [n]        son olay kayitlari (n varsayilan 30)' },
  { type: 'sys', content: '  /audit [n]     denetim kaydını goster (varsayilan 20)' },
];

/** Karakter/4 yaklasik token sayimi. */
export function approxTokens(messages: Message[]): { input: number; output: number; total: number } {
  let input = 0;
  let output = 0;
  for (const m of messages) {
    const t = Math.ceil(m.content.length / 4);
    if (m.role === 'assistant') output += t;
    else input += t;
  }
  return { input, output, total: input + output };
}

/** Gercek usage olan mesajlarin toplami. */
export function realTokens(messages: Message[]): {
  input: number;
  output: number;
  reasoning: number;
  /** Faz 11: önbellekten okunan prompt tokenları. */
  cacheRead: number;
  /** Faz 11: önbelleğe yazılan prompt tokenları. */
  cacheWrite: number;
  total: number;
  withUsage: number;
} {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let withUsage = 0;
  for (const m of messages) {
    if (
      m.tokens &&
      (m.tokens.input > 0 || m.tokens.output > 0 || (m.tokens.reasoning ?? 0) > 0)
    ) {
      input += m.tokens.input;
      output += m.tokens.output;
      reasoning += m.tokens.reasoning ?? 0;
      cacheRead += m.tokens.cacheRead ?? 0;
      cacheWrite += m.tokens.cacheWrite ?? 0;
      withUsage += 1;
    }
  }
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning,
    withUsage,
  };
}

export function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${n}`;
}

export function tokenSummaryLine(session: Session, prices?: Record<string, ModelPrice>): string {
  const real = realTokens(session.messages);
  const approx = approxTokens(session.messages);
  let cost = '';
  if (prices) {
    const { cost: c, priced } = sessionCost(session.messages, prices);
    if (priced > 0) {
      cost = ` · maliyet ~${formatCost(c)}${priced < real.withUsage ? ' (kısmi fiyat)' : ''}`;
    }
  }
  if (real.withUsage === 0) {
    return `/// token (yaklaşık): girdi ${approx.input} · çıktı ${approx.output} · toplam ${approx.total}`;
  }
  const reason = real.reasoning > 0 ? ` · reasoning ${formatTokenCount(real.reasoning)}` : '';
  // Faz 11: önbellek kullanımı görünür (önbellek işe yarıyor mu?).
  const cache =
    real.cacheRead > 0 || real.cacheWrite > 0
      ? ` · önbellek: ${formatTokenCount(real.cacheRead)} okuma · ${formatTokenCount(real.cacheWrite)} yazma`
      : '';
  const base =
    `/// token — gerçek: girdi ${formatTokenCount(real.input)} · çıktı ${formatTokenCount(real.output)}${reason}` +
    ` · toplam ${formatTokenCount(real.total)} (${real.withUsage}/${session.messages.length} mesaj)${cache}`;
  if (real.withUsage < session.messages.length) {
    return `${base}${cost} · yaklaşık toplam: ~${approx.total}`;
  }
  // Faz 4: oturum toplam maliyeti (reasoning dahil) son satırda görünür.
  return `${base}${cost}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${formatTime(ts)}`;
}

function authorLabel(m: Message, session: Session): string {
  if (m.role === 'user') return 'Sen';
  if (m.role === 'system') return 'System';
  return session.model || 'AI';
}

export function buildExportMarkdown(session: Session): string {
  const parts: string[] = [
    '# MacroCode Session Export',
    `**Tarih:** ${formatDate(Date.now())}`,
    `**Model:** ${session.model}`,
    `**Toplam mesaj:** ${session.messages.length}`,
    '',
    '---',
    '',
  ];
  for (const m of session.messages) {
    parts.push(`**[${formatTime(m.timestamp)}] ${authorLabel(m, session)}:**`);
    parts.push(m.content);
    if (m.reasoning?.trim()) {
      parts.push(`<details><summary>düşünme notları</summary>\n\n${m.reasoning}\n\n</details>`);
    }
    if (m.images && m.images.length > 0) {
      parts.push(`*[${m.images.length} görsel eklendi — dışa aktarımda yer almıyor]*`);
    }
    parts.push('');
  }
  parts.push('---');
  parts.push('*MacroCode tarafından dışa aktarıldı*');
  return parts.join('\n');
}

export interface SessionBackup {
  app: 'macrocode';
  version: 1;
  exportedAt: number;
  session: Session;
}

/** Tek oturumun JSON yedegi (dosya icerigi). */
export function buildSessionBackup(session: Session): string {
  const backup: SessionBackup = {
    app: 'macrocode',
    version: 1,
    exportedAt: Date.now(),
    session,
  };
  return JSON.stringify(backup, null, 2);
}

function isValidMessage(m: unknown): m is Message {
  if (!m || typeof m !== 'object') return false;
  const v = m as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    (v.role === 'user' || v.role === 'assistant' || v.role === 'system') &&
    typeof v.content === 'string' &&
    typeof v.timestamp === 'number'
  );
}

function normalizeSession(raw: unknown): Session {
  if (!raw || typeof raw !== 'object') throw new Error('oturum nesnesi bulunamadı');
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !Array.isArray(v.messages)) {
    throw new Error('geçersiz oturum: id/messages eksik');
  }
  const messages = (v.messages as unknown[]).filter(isValidMessage);
  if (messages.length !== (v.messages as unknown[]).length) {
    throw new Error('geçersiz oturum: bozuk mesajlar var');
  }
  const now = Date.now();
  const rawProvider = (VALID_PROVIDERS as string[]).includes(v.provider as string)
    ? (v.provider as Provider)
    : 'anthropic';
  const rawModel = typeof v.model === 'string' && v.model ? v.model : '';
  // P0-3: JSON yedekteki eski model ID'lerini güncel karşılığa taşı.
  const migrated = migrateProviderModel(rawProvider, rawModel);
  // Faz 12 B.6: kalıcı compaction özeti yedekle birlikte taşınır.
  const compaction =
    v.compaction && typeof v.compaction === 'object'
      ? (v.compaction as Session['compaction'])
      : undefined;
  return {
    id: v.id,
    name: typeof v.name === 'string' && v.name ? v.name : 'içe aktarılan session',
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : now,
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : now,
    messages,
    provider: migrated.provider,
    model: migrated.model,
    systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : '',
    ...(compaction ? { compaction } : {}),
  };
}

/**
 * JSON yedegini Session dizisine cevirir. Tek zarf (`{session}`),
 * ham Session ve toplu zarf (`{sessions: [...]}`) kabul edilir.
 */
export function parseSessionBackup(text: string): Session[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('geçersiz JSON: dosya okunamadı');
  }
  if (parsed && typeof parsed === 'object') {
    const v = parsed as Record<string, unknown>;
    if (Array.isArray(v.sessions)) {
      if (v.sessions.length === 0) throw new Error('yedekte oturum yok');
      return (v.sessions as unknown[]).map(normalizeSession);
    }
    if (v.session && typeof v.session === 'object') {
      return [normalizeSession(v.session)];
    }
  }
  return [normalizeSession(parsed)];
}

export function handleSlashCommand(raw: string, ctx: CommandContext): CommandResult {
  if (!raw.startsWith('/')) return { handled: false, lines: [] };
  const space = raw.indexOf(' ');
  const cmd = (space === -1 ? raw : raw.slice(0, space)).toLowerCase();
  const arg = (space === -1 ? '' : raw.slice(space + 1)).trim();

  switch (cmd) {
    case '/help':
      return { handled: true, lines: [...HELP_LINES] };

    case '/clear':
      ctx.clearView();
      return { handled: true, lines: [] };

    case '/reset': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: '✗ aktif session yok' }] };
      ctx.resetSession();
      return { handled: true, lines: [{ type: 'sys', content: '/// konuşma sıfırlandı' }] };
    }

    case '/session':
      ctx.createSession();
      return { handled: true, lines: [{ type: 'sys', content: '/// yeni session başlatıldı' }] };

    case '/model': {
      const customs = ctx.customModels?.() ?? [];
      const hasKey = ctx.providerHasKey;
      if (!arg) {
        // Anahtar durumuna göre sağlayıcı başına model sayısı.
        const models = resolveModels(customs);
        const lines: CommandLine[] = [
          { type: 'sys', content: `/// aktif model: ${ctx.model()}` },
        ];
        for (const p of PROVIDER_IDS) {
          const total = models.filter((m) => m.provider === p).length;
          if (total === 0) continue;
          const locked = hasKey ? !hasKey(p) : false;
          lines.push({
            type: locked ? 'warn' : 'sys',
            content: locked
              ? `/// ${p}: ${total} model · anahtar yok — listede gizli`
              : `/// ${p}: ${total} model`,
          });
        }
        return { handled: true, lines };
      }
      ctx.setModel(arg);
      const lines: CommandLine[] = [{ type: 'sys', content: `/// model: ${arg}` }];
      if (!isKnownModel(arg, customs)) {
        lines.push({ type: 'warn', content: '! bilinmeyen model id — yine de ayarlandı' });
      } else {
        const caps = getCapabilitiesForModel(arg, customs);
        if (caps) {
          const tags = [
            caps.tools ? 'tools✓' : 'tools✗',
            caps.vision ? 'vision✓' : null,
            caps.reasoning ? 'reasoning✓' : null,
          ].filter(Boolean).join(' · ');
          if (tags) lines.push({ type: 'sys', content: `/// capabilities: ${tags}` });
        }
        // Anahtar yoksa model seçilir ama uyarılır (liste kuralı burada da geçerli).
        const owner = getProviderForModel(arg, customs);
        if (owner && hasKey && !hasKey(owner)) {
          lines.push({
            type: 'warn',
            content: `! ${owner} anahtarı yok — /key ile ekle, aksi halde istek hata verir`,
          });
        }
      }
      return { handled: true, lines };
    }

    case '/provider': {
      const p = arg.toLowerCase() as Provider;
      if (!VALID_PROVIDERS.includes(p)) {
        const suggestion = suggestProvider(arg);
        return {
          handled: true,
          lines: [{ type: 'err', content: `✗ bilinmeyen sağlayıcı · ${VALID_PROVIDERS.join('/')} kullan${suggestion ? ` · bunu mu demek istedin: ${suggestion}?` : ''}` }],
        };
      }
      ctx.setProvider(p);
      return { handled: true, lines: [{ type: 'sys', content: `/// sağlayıcı: ${p}` }] };
    }

    case '/key':
      ctx.openSettings();
      return { handled: true, lines: [{ type: 'sys', content: '/// ayarlar açıldı — anahtarını girip kaydet' }] };

    case '/export': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: '✗ aktif session yok' }] };
      if (session.messages.length === 0) {
        return { handled: true, lines: [{ type: 'warn', content: '! dışa aktarılacak mesaj yok' }] };
      }
      if (arg.toLowerCase() === 'json') {
        return {
          handled: true,
          lines: [{ type: 'sys', content: '/// JSON yedeği hazır · indiriliyor' }],
          exportText: buildSessionBackup(session),
          exportFilename: 'macrocode-session.json',
          exportMime: 'application/json;charset=utf-8',
        };
      }
      return {
        handled: true,
        lines: [{ type: 'sys', content: '/// markdown hazır · indiriliyor' }],
        exportText: buildExportMarkdown(session),
        exportFilename: 'macrocode-session.md',
        exportMime: 'text/markdown;charset=utf-8',
      };
    }

    case '/backup': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: '✗ aktif session yok' }] };
      if (session.messages.length === 0) {
        return { handled: true, lines: [{ type: 'warn', content: '! yedeklenecek mesaj yok' }] };
      }
      return {
        handled: true,
        lines: [{ type: 'sys', content: '/// JSON yedeği hazır · indiriliyor' }],
        exportText: buildSessionBackup(session),
        exportFilename: 'macrocode-session.json',
        exportMime: 'application/json;charset=utf-8',
      };
    }

    case '/tokens': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: '✗ aktif session yok' }] };
      return {
        handled: true,
        lines: [{ type: 'sys', content: tokenSummaryLine(session, ctx.prices?.()) }],
      };
    }

    case '/system': {
      if (!arg) {
        return { handled: true, lines: [{ type: 'sys', content: '/// kullanım: /system <metin>' }] };
      }
      ctx.setSystemPrompt(arg);
      return { handled: true, lines: [{ type: 'sys', content: '/// system prompt güncellendi' }] };
    }

    default:
      return {
        handled: true,
        lines: [{ type: 'err', content: `✗ bilinmeyen komut: ${cmd} · /help ile listeye bak` }],
      };
  }
}
