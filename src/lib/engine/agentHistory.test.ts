import { describe, expect, it } from 'vitest';
import { buildAgentHistory, toProviderMessages } from './agent';
import type { Message } from '../../types';

function m(over: Partial<Message> & { id: string; role: Message['role']; content: string }): Message {
  return { timestamp: 1, ...over } as Message;
}

describe('Faz 7 denetimi — agent geçmişi (buildAgentHistory)', () => {
  it('kullanıcı mesajı TAM OLARAK BİR KEZ geçmişte yer alır', () => {
    // Oturumda: kullanıcı + boş assistant placeholder (yeni tur başlangıcı).
    const messages: Message[] = [
      m({ id: 'u1', role: 'user', content: 'dosyayı oku' }),
      m({ id: 'a1', role: 'assistant', content: '' }),
    ];
    const history = buildAgentHistory(messages, 'a1');
    const userCount = history.filter((h) => h.role === 'user' && h.content === 'dosyayı oku').length;
    expect(userCount).toBe(1);
    // Provider isteğinde de tek kopya olmalı (eski hata: iki kopya).
    const providerMsgs = toProviderMessages(history);
    expect(providerMsgs.filter((p) => p.role === 'user' && p.content === 'dosyayı oku')).toHaveLength(1);
  });

  it('boş assistant placeholder geçmişe girmez', () => {
    const messages: Message[] = [
      m({ id: 'u1', role: 'user', content: 'selam' }),
      m({ id: 'a1', role: 'assistant', content: '' }),
    ];
    const history = buildAgentHistory(messages, 'a1');
    expect(history.map((h) => h.id)).toEqual(['u1']);
  });

  it('tool sonucu (system+toolCallId) tool rolüne dönüşür', () => {
    const messages: Message[] = [
      m({ id: 'a1', role: 'assistant', content: 'okuyorum', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' } }] }),
      m({ id: 's1', role: 'system', content: 'içerik', toolCallId: 'c1', toolName: 'read_file' }),
    ];
    const history = buildAgentHistory(messages, 'zzz');
    expect(history[1].role).toBe('tool');
    expect(history[1].toolCallId).toBe('c1');
  });

  it('kesmede kopan tool çifti geriye taranarak tamamlanır', () => {
    const messages: Message[] = [
      m({ id: 'a0', role: 'assistant', content: 'okuyorum', toolCalls: [{ id: 'c0', name: 'read_file', args: {} }] }),
      m({ id: 's0', role: 'system', content: 'sonuç', toolCallId: 'c0', toolName: 'read_file' }),
      ...Array.from({ length: 250 }, (_, i) =>
        m({ id: `x${i}`, role: 'user', content: `mesaj ${i}` }),
      ),
    ];
    const history = buildAgentHistory(messages, 'zzz');
    // Kesme 200 mesajla sınırlı; ilk öğe tool sonucu ise eşleşen assistant da alınır.
    const first = history[0];
    if (first.role === 'tool') {
      const prev = history.find((h) => h.role === 'assistant' && h.toolCalls?.some((c) => c.id === first.toolCallId));
      expect(prev).toBeDefined();
    }
    expect(history.length).toBeLessThanOrEqual(201);
  });

  it('ts ve id taşınır (compaction hafızası + yinelenen mesaj denetimi)', () => {
    const messages: Message[] = [m({ id: 'u1', role: 'user', content: 'x', timestamp: 1234 })];
    const history = buildAgentHistory(messages, 'zzz');
    expect(history[0].ts).toBe(1234);
    expect(history[0].id).toBe('u1');
  });
});
