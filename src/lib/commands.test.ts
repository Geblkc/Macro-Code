import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_SPECS,
  approxTokens,
  buildExportMarkdown,
  buildSessionBackup,
  filterCommands,
  handleSlashCommand,
  parseSessionBackup,
  tokenSummaryLine,
  type CommandContext,
} from './commands';
import { t } from './i18n/core';
import type { TranslationKey } from './i18n/locales/tr';
import type { Session } from '../types';

function sampleSession(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'test',
    createdAt: 1000,
    updatedAt: 1000,
    messages: [],
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    systemPrompt: '',
    ...over,
  };
}

function fakeCtx(session: Session | null): CommandContext & {
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const rec = (k: string, v?: unknown) => {
    calls[k] = [...(calls[k] ?? []), v];
  };
  return {
    calls,
    getSession: () => session,
    provider: () => session?.provider ?? 'anthropic',
    model: () => session?.model || 'claude-opus-5-5',
    createSession: () => rec('createSession'),
    clearView: () => rec('clearView'),
    resetSession: () => rec('resetSession'),
    setProvider: (p) => rec('setProvider', p),
    setModel: (m) => rec('setModel', m),
    setSystemPrompt: (t) => rec('setSystemPrompt', t),
    openSettings: () => rec('openSettings'),
  };
}

describe('B — slash komutları', () => {
  it('/help tüm komutları listeler', () => {
    const r = handleSlashCommand('/help', fakeCtx(sampleSession()));
    expect(r.handled).toBe(true);
    expect(r.lines[0].content).toContain('komutlar');
    expect(r.lines.some((l) => l.content.includes('/model'))).toBe(true);
    expect(r.lines.some((l) => l.content.includes('/backup'))).toBe(true);
    expect(r.lines.some((l) => l.content.includes('/compact'))).toBe(true);
  });

  it('/model anahtarı olmayan sağlayıcıyı uyarıyla gösterir', () => {
    const ctx = fakeCtx(sampleSession());
    ctx.providerHasKey = (p) => p === 'anthropic';
    const r = handleSlashCommand('/model', ctx);
    const text = r.lines.map((l) => l.content).join('\n');
    // Anahtarı olan sağlayıcı normal, olmayan uyarı satırı olarak çıkar.
    expect(text).toContain('anthropic');
    expect(text).toContain('anahtar yok');
    expect(r.lines.some((l) => l.type === 'warn')).toBe(true);
  });

  it('/model <id> anahtarsız sağlayıcıda uyarır', () => {
    const ctx = fakeCtx(sampleSession());
    ctx.providerHasKey = () => false;
    const r = handleSlashCommand('/model gpt-6.1-sol', ctx);
    const text = r.lines.map((l) => l.content).join('\n');
    expect(text).toContain('anahtarı yok');
    expect(r.lines.some((l) => l.type === 'warn')).toBe(true);
  });

  it('/model <id> anahtar varsa uyarı üretmez', () => {
    const ctx = fakeCtx(sampleSession());
    ctx.providerHasKey = () => true;
    const r = handleSlashCommand('/model gpt-6.1-sol', ctx);
    expect(r.lines.some((l) => l.type === 'warn')).toBe(false);
  });

  it('/clear görünümü temizler, satır yazmaz', () => {
    const ctx = fakeCtx(sampleSession());
    const r = handleSlashCommand('/clear', ctx);
    expect(r.lines).toHaveLength(0);
    expect(ctx.calls.clearView).toHaveLength(1);
  });

  it('/reset: session yoksa err, varsa sıfırlar', () => {
    const r1 = handleSlashCommand('/reset', fakeCtx(null));
    expect(r1.lines[0].type).toBe('err');
    const ctx = fakeCtx(sampleSession());
    const r2 = handleSlashCommand('/reset', ctx);
    expect(r2.lines[0].content).toContain('sıfırlandı');
    expect(ctx.calls.resetSession).toHaveLength(1);
  });

  it('/session yeni oturum açar', () => {
    const ctx = fakeCtx(sampleSession());
    const r = handleSlashCommand('/session', ctx);
    expect(r.lines[0].content).toContain('yeni session');
    expect(ctx.calls.createSession).toHaveLength(1);
  });

  it('/model: argsız gösterir, bilinen capabilityli, bilinmeyen uyarılı', () => {
    const ctx = fakeCtx(sampleSession());
    expect(handleSlashCommand('/model', ctx).lines[0].content).toContain('claude-opus-5-5');
    const r1 = handleSlashCommand('/model gpt-6.1-sol', ctx);
    expect(r1.lines[0].content).toContain('gpt-6.1-sol');
    expect(r1.lines.some((l) => l.content.includes('capabilities'))).toBe(true);
    expect(ctx.calls.setModel).toContain('gpt-6.1-sol');
    const r2 = handleSlashCommand('/model uydurma-xyz', ctx);
    expect(r2.lines.some((l) => l.type === 'warn')).toBe(true);
  });

  it('/provider: bilinmeyen err, bilinen sys', () => {
    const ctx = fakeCtx(sampleSession());
    expect(handleSlashCommand('/provider xyz', ctx).lines[0].type).toBe('err');
    const r = handleSlashCommand('/provider ollama', ctx);
    expect(r.lines[0].content).toContain('ollama');
    expect(ctx.calls.setProvider).toContain('ollama');
  });

  it('/key ayarları açar', () => {
    const ctx = fakeCtx(sampleSession());
    const r = handleSlashCommand('/key', ctx);
    expect(ctx.calls.openSettings).toHaveLength(1);
    expect(r.lines[0].content).toContain('ayarlar');
  });

  it('/export: boşsa warn, doluysa markdown + json varyantı', () => {
    const empty = fakeCtx(sampleSession());
    expect(handleSlashCommand('/export', empty).lines[0].type).toBe('warn');
    const s = sampleSession({
      messages: [
        { id: 'm1', role: 'user', content: 'merhaba', timestamp: 1000 },
        { id: 'm2', role: 'assistant', content: 'selam', timestamp: 1001 },
      ],
    });
    const md = handleSlashCommand('/export', fakeCtx(s));
    expect(md.exportText).toContain('# MacroCode Session Export');
    expect(md.exportText).toContain('merhaba');
    expect(md.exportMime).toContain('markdown');
    const js = handleSlashCommand('/export json', fakeCtx(s));
    expect(js.exportMime).toContain('json');
    expect(() => JSON.parse(js.exportText ?? '')).not.toThrow();
    const b = handleSlashCommand('/backup', fakeCtx(s));
    expect(b.exportMime).toContain('json');
  });

  it('/tokens: usagesiz approx, usageli gerçek', () => {
    const s1 = sampleSession({
      messages: [{ id: 'm1', role: 'user', content: 'abcd', timestamp: 1 }],
    });
    expect(tokenSummaryLine(s1)).toContain('yaklaşık');
    const s2 = sampleSession({
      messages: [
        { id: 'm1', role: 'user', content: 'abcd', timestamp: 1, tokens: { input: 1500, output: 0 } },
        { id: 'm2', role: 'assistant', content: 'efgh', timestamp: 2, tokens: { input: 0, output: 2500 } },
      ],
    });
    const line = tokenSummaryLine(s2);
    expect(line).toContain('gerçek');
    expect(line).toContain('1.5k');
    expect(approxTokens(s1.messages).total).toBe(1);
  });

  it('/system: argsız kullanım, argümanlı günceller', () => {
    const ctx = fakeCtx(sampleSession());
    expect(handleSlashCommand('/system', ctx).lines[0].content).toContain('kullanım');
    const r = handleSlashCommand('/system sen naziksin', ctx);
    expect(ctx.calls.setSystemPrompt).toContain('sen naziksin');
    expect(r.lines[0].content).toContain('güncellendi');
  });

  it('bilinmeyen komut err, slashsız handled:false', () => {
    expect(handleSlashCommand('/yokboyle', fakeCtx(sampleSession())).lines[0].type).toBe('err');
    expect(handleSlashCommand('merhaba', fakeCtx(sampleSession()))).toEqual({
      handled: false,
      lines: [],
    });
  });

  it('backup roundtrip: build → parse aynı session', () => {
    const s = sampleSession({
      messages: [{ id: 'm1', role: 'user', content: 'x', timestamp: 5 }],
    });
    const out = parseSessionBackup(buildSessionBackup(s));
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('s1');
    expect(out[0].messages).toHaveLength(1);
  });

  it('parse: bozuk JSON ve bozuk mesaj reddedilir', () => {
    expect(() => parseSessionBackup('değil json')).toThrow();
    expect(() =>
      parseSessionBackup(JSON.stringify({ session: { id: 'a', messages: [{ id: 1 }] } })),
    ).toThrow();
    // Toplu zarf kabul edilir.
    const batch = parseSessionBackup(
      JSON.stringify({ sessions: [sampleSession({ id: 'a' }), sampleSession({ id: 'b' })] }),
    );
    expect(batch.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('export markdown yazar etiketi ve başlığı taşır', () => {
    const s = sampleSession({
      model: 'gpt-6.1-sol',
      messages: [{ id: 'm1', role: 'assistant', content: 'yanıt', timestamp: 1 }],
    });
    const md = buildExportMarkdown(s);
    expect(md).toContain('gpt-6.1-sol');
    expect(md).toContain('MacroCode tarafından dışa aktarıldı');
  });

  it('Faz 4: export reasoning bloğunu içerir, roundtrip korur', () => {
    const s = sampleSession({
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: 'yanıt',
          timestamp: 1,
          reasoning: 'derin düşünce',
          thinking: [{ thinking: 'p', signature: 's' }],
        } as unknown as Session['messages'][number],
      ],
    });
    expect(buildExportMarkdown(s)).toContain('derin düşünce');
    const back = parseSessionBackup(buildSessionBackup(s))[0].messages[0] as unknown as Record<
      string,
      unknown
    >;
    expect(back.reasoning).toBe('derin düşünce');
  });

  it('setModel/setProvider çağrıları spy ile doğrulanır', () => {
    const setModel = vi.fn();
    const setProvider = vi.fn();
    const ctx: CommandContext = { ...fakeCtx(sampleSession()), setModel, setProvider };
    handleSlashCommand('/model gpt-6.1-sol', ctx);
    handleSlashCommand('/provider gemini', ctx);
    expect(setModel).toHaveBeenCalledWith('gpt-6.1-sol');
    expect(setProvider).toHaveBeenCalledWith('gemini');
  });

  it('P0-3 migration: eski model ID yedekten güncel modele taşınır', () => {    const old = sampleSession({ provider: 'openai', model: 'gpt-4o' });
    const out = parseSessionBackup(buildSessionBackup(old));
    expect(out[0].model).toBe('gpt-6.1-sol');
    expect(out[0].provider).toBe('openai');
    const old2 = sampleSession({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(parseSessionBackup(buildSessionBackup(old2))[0].model).toBe('claude-sonnet-5-5');
  });

  it('P0-3 migration: güncel ve özel IDlere dokunulmaz, boş korunur', () => {
    const cur = sampleSession({ provider: 'openai', model: 'gpt-6.1-sol' });
    expect(parseSessionBackup(buildSessionBackup(cur))[0].model).toBe('gpt-6.1-sol');
    const custom = sampleSession({ provider: 'openai', model: 'benim-ozel-modelim' });
    const parsed = parseSessionBackup(buildSessionBackup(custom))[0];
    expect(parsed.model).toBe('benim-ozel-modelim');
    const empty = sampleSession({ provider: 'openai', model: '' });
    expect(parseSessionBackup(buildSessionBackup(empty))[0].model).toBe('');
  });

  it('Faz 1 K5: normalizeSession tool alanlarını korur (export/import roundtrip)', () => {
    const s = sampleSession({
      messages: [
        {
          id: 'a1',
          role: 'assistant',
          content: 'bakıyorum',
          timestamp: 1,
          toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' } }],
        } as unknown as Session['messages'][number],
        {
          id: 't1',
          role: 'system',
          content: 'içerik',
          timestamp: 2,
          toolCallId: 'c1',
          toolName: 'read_file',
        } as unknown as Session['messages'][number],
      ],
    });
    const out = parseSessionBackup(buildSessionBackup(s));
    expect(out[0].messages).toHaveLength(2);
    const back = out[0].messages as Array<Record<string, unknown>>;
    expect((back[0].toolCalls as Array<{ id: string }>)[0].id).toBe('c1');
    expect(back[1].toolCallId).toBe('c1');
    expect(back[1].toolName).toBe('read_file');
    // /export json çıktısında toolCalls mevcut
    const js = handleSlashCommand('/export json', fakeCtx(s));
    expect(js.exportText).toContain('toolCalls');
    expect(js.exportText).toContain('toolCallId');
  });
});

describe('Slash önerileri (COMMAND_SPECS tek kaynağı)', () => {
  it('komut adları benzersizdir ve her komutun /help satır anahtarı 5 dilde vardır', () => {
    const names = COMMAND_SPECS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of COMMAND_SPECS) {
      // Anahtar eksikse t() ham anahtarı döndürür (fallback zinciri son adımı).
      const key = `commands.help.${c.name}` as TranslationKey;
      expect(t(key)).not.toBe(key);
      expect(t(c.descKey)).not.toBe(c.descKey);
    }
  });

  it('requiresArg yalnızca argümanı zorunlu komutlarda', () => {
    expect(COMMAND_SPECS.filter((c) => c.requiresArg).map((c) => c.name)).toEqual([
      'provider',
      'note',
    ]);
  });

  it('filtre: boş sorgu tüm tabloyu döndürür (/ islak veya kuru)', () => {
    expect(filterCommands('/')).toHaveLength(COMMAND_SPECS.length);
    expect(filterCommands('')).toHaveLength(COMMAND_SPECS.length);
  });

  it('filtre: önek eşleşmeleri ilk, içerme eşleşmeleri sonra', () => {
    expect(filterCommands('/ex').map((c) => c.name)).toEqual(['export', 'context']);
    expect(filterCommands('/se').map((c) => c.name)).toEqual(['session', 'reset']);
  });

  it('filtre: "/" öneki ve büyük/küçük harf önemsizdir', () => {
    expect(filterCommands('/EX').map((c) => c.name)).toEqual(['export', 'context']);
  });

  it('filtre: eşleşme yoksa boş liste', () => {
    expect(filterCommands('/zzz')).toEqual([]);
  });

  it('/help tablodan üretilir; satır sayısı ve zorunlu alanlar korunur', () => {
    const r = handleSlashCommand('/help', fakeCtx(sampleSession()));
    expect(r.lines.length).toBe(COMMAND_SPECS.length + 2); // başlık + approvalModes
    expect(r.lines.some((l) => l.content.includes('manual='))).toBe(true);
    expect(r.lines.some((l) => l.content.includes('anthropic/openai'))).toBe(true);
  });
});
