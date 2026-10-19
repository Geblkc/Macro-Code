import { beforeEach, describe, expect, it } from 'vitest';
import { useSessionStore } from './session';
import type { Message } from '../types';

function msg(over: Partial<Message> & { id: string; role: Message['role']; content: string }): Message {
  return { timestamp: 1, ...over } as Message;
}

describe('Faz 1 G1 — session tool geçmişi persist', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], activeSessionId: null });
  });

  it('tool alanları addMessage + partialize roundtrip korunur', () => {
    const s = useSessionStore.getState().createSession();
    useSessionStore.getState().addMessage(s.id, msg({
      id: 'a1',
      role: 'assistant',
      content: 'bakıyorum',
      toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' } }],
    }));
    useSessionStore.getState().addToolMessages(s.id, [
      { role: 'system', content: 'içerik', toolCallId: 'c1', toolName: 'read_file' },
    ]);
    const sess = useSessionStore.getState().sessions.find((x) => x.id === s.id)!;
    expect(sess.messages).toHaveLength(2);
    expect(sess.messages[0].toolCalls?.[0].id).toBe('c1');
    expect(sess.messages[1].toolCallId).toBe('c1');
    // partialize simülasyonu: JSON roundtrip
    const json = JSON.stringify(sess);
    const back = JSON.parse(json) as typeof sess;
    expect(back.messages[0].toolCalls?.[0].name).toBe('read_file');
    expect(back.messages[1].toolName).toBe('read_file');
  });

  it('eski kayıt (alan yok) sorunsuz açılır', () => {
    const s = useSessionStore.getState().createSession();
    useSessionStore.getState().addMessage(s.id, msg({ id: 'm1', role: 'user', content: 'selam' }));
    const sess = useSessionStore.getState().sessions.find((x) => x.id === s.id)!;
    expect(sess.messages[0].toolCalls).toBeUndefined();
    expect(sess.messages[0].toolCallId).toBeUndefined();
    expect(sess.messages[0].isError).toBeUndefined();
  });

  it('appendToolCalls assistant mesajına ekler', () => {
    const s = useSessionStore.getState().createSession();
    useSessionStore.getState().addMessage(s.id, msg({ id: 'a9', role: 'assistant', content: '' }));
    useSessionStore.getState().appendToolCalls(s.id, 'a9', [
      { id: 'c9', name: 'exec', args: { cmd: 'ls' } },
    ]);
    const m = useSessionStore.getState().sessions.find((x) => x.id === s.id)!.messages[0];
    expect(m.toolCalls).toHaveLength(1);
    expect(m.toolCalls?.[0].name).toBe('exec');
  });

  it('Faz 4: reasoning ve thinking kalıcı katmanda taşınır', () => {
    const s = useSessionStore.getState().createSession();
    useSessionStore.getState().addMessage(s.id, msg({ id: 'a1', role: 'assistant', content: 'yanıt' }));
    useSessionStore.getState().appendReasoning(s.id, 'a1', 'önce ');
    useSessionStore.getState().appendReasoning(s.id, 'a1', 'düşündüm');
    useSessionStore.getState().setAssistantThinking(s.id, 'a1', [
      { thinking: 'plan', signature: 'sig' },
    ]);
    useSessionStore.getState().setMessageUsage(s.id, 'a1', { input: 10, output: 5, reasoning: 3 });
    const m = useSessionStore.getState().sessions.find((x) => x.id === s.id)!.messages[0];
    expect(m.reasoning).toBe('önce düşündüm');
    expect(m.thinking).toEqual([{ thinking: 'plan', signature: 'sig' }]);
    expect(m.tokens).toMatchObject({ input: 10, output: 5, reasoning: 3 });
    // JSON roundtrip korur
    const back = JSON.parse(JSON.stringify(m)) as typeof m;
    expect(back.reasoning).toBe('önce düşündüm');
    expect(back.thinking?.[0].signature).toBe('sig');
  });
});

describe('Faz 7 A3 — agent mesaj bütünlüğü', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [], activeSessionId: null });
  });

  it('tool sonucundan sonra gelen metin aynı assistant mesajına yazılır', () => {
    const s = useSessionStore.getState().createSession();
    const st = useSessionStore.getState();
    st.addMessage(s.id, msg({ id: 'u1', role: 'user', content: 'oku' }));
    st.addMessage(s.id, msg({ id: 'a1', role: 'assistant', content: '' }));
    // 1. tur metni
    st.appendToMessage(s.id, 'a1', 'ilk tur ');
    // tool sonucu kalıcı katmana sistem mesajı olarak düşer
    st.addToolMessages(s.id, [
      { role: 'system', content: 'dosya içeriği', toolCallId: 'c1', toolName: 'read_file' },
    ]);
    // 2. tur metni — ESKİ davranış: yeni mesaj açılırdı
    st.appendToMessage(s.id, 'a1', 'ikinci tur');

    const msgs = useSessionStore.getState().sessions.find((x) => x.id === s.id)!.messages;
    const assistants = msgs.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe('ilk tur ikinci tur');
  });

  it('appendToMessage hedef mesaj yoksa aynı id ile yeni assistant mesajı açar', () => {
    const s = useSessionStore.getState().createSession();
    useSessionStore.getState().appendToMessage(s.id, 'yok', 'merhaba');
    const msgs = useSessionStore.getState().sessions.find((x) => x.id === s.id)!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ id: 'yok', role: 'assistant', content: 'merhaba' });
  });

  it('updateLastMessage boş davranışı korunur (sohbet akışı)', () => {
    const s = useSessionStore.getState().createSession();
    const st = useSessionStore.getState();
    st.addMessage(s.id, msg({ id: 'u1', role: 'user', content: 'selam' }));
    st.updateLastMessage(s.id, 'yanıt');
    const msgs = useSessionStore.getState().sessions.find((x) => x.id === s.id)!.messages;
    // son mesaj user → yeni assistant mesajı açılır
    expect(msgs[msgs.length - 1]).toMatchObject({ role: 'assistant', content: 'yanıt' });
  });
});
