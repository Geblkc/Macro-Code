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
import { t } from './i18n/core';
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

/** Yardım metni (dil ayarına göre üretilir). */
function helpLines(): CommandLine[] {
  return [
    { type: 'sys', content: t('commands.help.header') },
    { type: 'sys', content: t('commands.help.help') },
    { type: 'sys', content: t('commands.help.clear') },
    { type: 'sys', content: t('commands.help.reset') },
    { type: 'sys', content: t('commands.help.session') },
    { type: 'sys', content: t('commands.help.model') },
    { type: 'sys', content: t('commands.help.provider', { providers: PROVIDER_IDS.join('/') }) },
    { type: 'sys', content: t('commands.help.key') },
    { type: 'sys', content: t('commands.help.export') },
    { type: 'sys', content: t('commands.help.backup') },
    { type: 'sys', content: t('commands.help.tokens') },
    { type: 'sys', content: t('commands.help.compact') },
    { type: 'sys', content: t('commands.help.system') },
    { type: 'sys', content: t('commands.help.root') },
    { type: 'sys', content: t('commands.help.files') },
    { type: 'sys', content: t('commands.help.apply') },
    { type: 'sys', content: t('commands.help.undo') },
    { type: 'sys', content: t('commands.help.skill') },
    { type: 'sys', content: t('commands.help.approval') },
    { type: 'sys', content: t('commands.help.approvalModes') },
    { type: 'sys', content: t('commands.help.context') },
    { type: 'sys', content: t('commands.help.note') },
    { type: 'sys', content: t('commands.help.log') },
    { type: 'sys', content: t('commands.help.audit') },
  ];
}

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
      cost = t('tokens.cost', { cost: formatCost(c) }) +
        (priced < real.withUsage ? t('tokens.costPartial') : '');
    }
  }
  if (real.withUsage === 0) {
    return t('tokens.approx', {
      input: approx.input,
      output: approx.output,
      total: approx.total,
    });
  }
  const reason = real.reasoning > 0 ? t('tokens.reasoning', { amount: formatTokenCount(real.reasoning) }) : '';
  // Faz 11: önbellek kullanımı görünür (önbellek işe yarıyor mu?).
  const cache =
    real.cacheRead > 0 || real.cacheWrite > 0
      ? t('tokens.cache', {
          read: formatTokenCount(real.cacheRead),
          write: formatTokenCount(real.cacheWrite),
        })
      : '';
  const base = t('tokens.real', {
    input: formatTokenCount(real.input),
    output: formatTokenCount(real.output),
    reasoning: reason,
    total: formatTokenCount(real.total),
    withUsage: real.withUsage,
    messages: session.messages.length,
    cache,
  });
  if (real.withUsage < session.messages.length) {
    return `${base}${cost}${t('tokens.approxTotal', { total: approx.total })}`;
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
  if (m.role === 'user') return t('export.authorUser');
  if (m.role === 'system') return t('export.authorSystem');
  return session.model || 'AI';
}

export function buildExportMarkdown(session: Session): string {
  const parts: string[] = [
    t('export.title'),
    t('export.date', { date: formatDate(Date.now()) }),
    t('export.model', { model: session.model }),
    t('export.messageCount', { count: session.messages.length }),
    '',
    '---',
    '',
  ];
  for (const m of session.messages) {
    parts.push(`**[${formatTime(m.timestamp)}] ${authorLabel(m, session)}:**`);
    parts.push(m.content);
    if (m.reasoning?.trim()) {
      parts.push(`<details><summary>${t('export.reasoning')}</summary>\n\n${m.reasoning}\n\n</details>`);
    }
    if (m.images && m.images.length > 0) {
      parts.push(t('export.images', { count: m.images.length }));
    }
    parts.push('');
  }
  parts.push('---');
  parts.push(t('export.footer'));
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
  if (!raw || typeof raw !== 'object') throw new Error(t('errors.sessionObjectMissing'));
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !Array.isArray(v.messages)) {
    throw new Error(t('errors.sessionInvalidShape'));
  }
  const messages = (v.messages as unknown[]).filter(isValidMessage);
  if (messages.length !== (v.messages as unknown[]).length) {
    throw new Error(t('errors.sessionCorruptMessages'));
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
    name: typeof v.name === 'string' && v.name ? v.name : t('errors.importSessionName'),
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
    throw new Error(t('errors.invalidJson'));
  }
  if (parsed && typeof parsed === 'object') {
    const v = parsed as Record<string, unknown>;
    if (Array.isArray(v.sessions)) {
      if (v.sessions.length === 0) throw new Error(t('errors.backupEmpty'));
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
      return { handled: true, lines: helpLines() };

    case '/clear':
      ctx.clearView();
      return { handled: true, lines: [] };

    case '/reset': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: t('commands.noSession') }] };
      ctx.resetSession();
      return { handled: true, lines: [{ type: 'sys', content: t('commands.resetDone') }] };
    }

    case '/session':
      ctx.createSession();
      return { handled: true, lines: [{ type: 'sys', content: t('commands.sessionStarted') }] };

    case '/model': {
      const customs = ctx.customModels?.() ?? [];
      const hasKey = ctx.providerHasKey;
      if (!arg) {
        // Anahtar durumuna göre sağlayıcı başına model sayısı.
        const models = resolveModels(customs);
        const lines: CommandLine[] = [
          { type: 'sys', content: t('commands.activeModel', { model: ctx.model() }) },
        ];
        for (const p of PROVIDER_IDS) {
          const total = models.filter((m) => m.provider === p).length;
          if (total === 0) continue;
          const locked = hasKey ? !hasKey(p) : false;
          lines.push({
            type: locked ? 'warn' : 'sys',
            content: locked
              ? t('commands.providerModelsLocked', { provider: p, count: total })
              : t('commands.providerModels', { provider: p, count: total }),
          });
        }
        return { handled: true, lines };
      }
      ctx.setModel(arg);
      const lines: CommandLine[] = [{ type: 'sys', content: t('commands.modelSet', { model: arg }) }];
      if (!isKnownModel(arg, customs)) {
        lines.push({ type: 'warn', content: t('commands.modelUnknown') });
      } else {
        const caps = getCapabilitiesForModel(arg, customs);
        if (caps) {
          const tags = [
            caps.tools ? 'tools✓' : 'tools✗',
            caps.vision ? 'vision✓' : null,
            caps.reasoning ? 'reasoning✓' : null,
          ].filter(Boolean).join(' · ');
          if (tags) lines.push({ type: 'sys', content: t('commands.capabilities', { tags }) });
        }
        // Anahtar yoksa model seçilir ama uyarılır (liste kuralı burada da geçerli).
        const owner = getProviderForModel(arg, customs);
        if (owner && hasKey && !hasKey(owner)) {
          lines.push({ type: 'warn', content: t('commands.providerNoKey', { provider: owner }) });
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
          lines: [
            {
              type: 'err',
              content: t('commands.unknownProvider', {
                providers: VALID_PROVIDERS.join('/'),
                suggestion: suggestion ? t('commands.didYouMean', { provider: suggestion }) : '',
              }),
            },
          ],
        };
      }
      ctx.setProvider(p);
      return { handled: true, lines: [{ type: 'sys', content: t('commands.providerSet', { provider: p }) }] };
    }

    case '/key':
      ctx.openSettings();
      return { handled: true, lines: [{ type: 'sys', content: t('commands.settingsOpened') }] };

    case '/export': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: t('commands.noSession') }] };
      if (session.messages.length === 0) {
        return { handled: true, lines: [{ type: 'warn', content: t('commands.exportEmpty') }] };
      }
      if (arg.toLowerCase() === 'json') {
        return {
          handled: true,
          lines: [{ type: 'sys', content: t('commands.jsonReady') }],
          exportText: buildSessionBackup(session),
          exportFilename: 'macrocode-session.json',
          exportMime: 'application/json;charset=utf-8',
        };
      }
      return {
        handled: true,
        lines: [{ type: 'sys', content: t('commands.markdownReady') }],
        exportText: buildExportMarkdown(session),
        exportFilename: 'macrocode-session.md',
        exportMime: 'text/markdown;charset=utf-8',
      };
    }

    case '/backup': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: t('commands.noSession') }] };
      if (session.messages.length === 0) {
        return { handled: true, lines: [{ type: 'warn', content: t('commands.backupEmpty') }] };
      }
      return {
        handled: true,
        lines: [{ type: 'sys', content: t('commands.jsonReady') }],
        exportText: buildSessionBackup(session),
        exportFilename: 'macrocode-session.json',
        exportMime: 'application/json;charset=utf-8',
      };
    }

    case '/tokens': {
      const session = ctx.getSession();
      if (!session) return { handled: true, lines: [{ type: 'err', content: t('commands.noSession') }] };
      return {
        handled: true,
        lines: [{ type: 'sys', content: tokenSummaryLine(session, ctx.prices?.()) }],
      };
    }

    case '/system': {
      if (!arg) {
        return { handled: true, lines: [{ type: 'sys', content: t('commands.systemUsage') }] };
      }
      ctx.setSystemPrompt(arg);
      return { handled: true, lines: [{ type: 'sys', content: t('commands.systemUpdated') }] };
    }

    default:
      return {
        handled: true,
        lines: [{ type: 'err', content: t('commands.unknownCommand', { command: cmd }) }],
      };
  }
}
