import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Message, Provider, Session, SessionCompaction } from '../types';
import type { UsageLike } from '../lib/engine/types';
import { t } from '../lib/i18n/core';
import { DEFAULT_MODELS, useSettingsStore } from './settings';

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uid(): string {
  return createId();
}

/** Boş oturum adı (aktif dilde gösterilir). */
function defaultName(): string {
  return t('session.defaultName');
}

function autoName(content: string): string {
  const name = content.trim().slice(0, 20);
  return name || defaultName();
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  isStreaming: boolean;

  createSession: () => Session;
  deleteSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  /** Faz 1 (K5): tool sonuçlarını kalıcı katmana sistem mesajı olarak yazar. */
  addToolMessages: (
    sessionId: string,
    items: Array<Partial<Message> & { role: 'system'; content: string }>,
  ) => void;
  /** Faz 1 (K5): assistant mesajına tool çağrılarını ekler (çok turlu geçmiş için). */
  appendToolCalls: (
    sessionId: string,
    assistantId: string,
    calls: NonNullable<Message['toolCalls']>,
  ) => void;
  /**
   * Streaming delta'si ekler: son mesaj assistant ise icerige eklenir,
   * degilse yeni assistant mesaji acilir.
   */
  updateLastMessage: (sessionId: string, content: string) => void;
  /**
   * Faz 7 A3: **belirli** bir assistant mesajına metin ekler.
   *
   * Agent döngüsünde tool sonuçları kalıcı katmana `role: 'system'` mesajı
   * olarak yazılır; `updateLastMessage` "son mesaj assistant olmalı" kuralı
   * yüzünden bir sonraki turdaki metni **yeni** bir assistant mesajına
   * yazıyordu (cevap parçalanıyordu). Agent artık hedef mesajı sabit tutar.
   */
  appendToMessage: (sessionId: string, messageId: string, content: string) => void;
  /**
   * Faz 12 B.6: kalıcı compaction özetini yaz/temizle (restart sonrası bağlam korunur).
   */
  setCompaction: (sessionId: string, compaction: SessionCompaction | null) => void;
  clearSession: (sessionId: string) => void;
  removeMessage: (sessionId: string, messageId: string) => void;
  updateSessionModel: (sessionId: string, patch: { provider?: Provider; model?: string }) => void;
  setMessageUsage: (
    sessionId: string,
    messageId: string,
    usage: UsageLike,
  ) => void;
  /** Faz 4: reasoning delta'sini assistant mesajına ekler. */
  appendReasoning: (sessionId: string, messageId: string, delta: string) => void;
  /** Faz 4: turun imzalı thinking bloklarını assistant mesajına yazar. */
  setAssistantThinking: (
    sessionId: string,
    messageId: string,
    blocks: Array<{ thinking: string; signature: string }>,
  ) => void;
  setStreaming: (value: boolean) => void;
  getActiveSession: () => Session | null;
}

const noopStorage = {
  getItem: (_name: string): string | null => null,
  setItem: (_name: string, _value: string): void => {},
  removeItem: (_name: string): void => {},
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,
      isStreaming: false,

      createSession: () => {
        const settings = useSettingsStore.getState();
        const session: Session = {
          id: uid(),
          name: defaultName(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
          provider: settings.currentProvider,
          model: settings.currentModel || DEFAULT_MODELS[settings.currentProvider],
          systemPrompt: settings.systemPrompt,
        };
        set((s) => ({
          sessions: [...s.sessions, session],
          activeSessionId: session.id,
        }));
        return session;
      },

      deleteSession: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((sess) => sess.id !== id);
          const activeSessionId =
            s.activeSessionId === id
              ? (sessions[0]?.id ?? null)
              : s.activeSessionId;
          return { sessions, activeSessionId };
        }),

      setActiveSession: (id) =>
        set((s) => (s.sessions.some((sess) => sess.id === id) ? { activeSessionId: id } : {})),

      addMessage: (sessionId, message) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const hasUser = sess.messages.some((m) => m.role === 'user');
            const name =
              message.role === 'user' && !hasUser ? autoName(message.content) : sess.name;
            return {
              ...sess,
              name,
              updatedAt: Date.now(),
              messages: [...sess.messages, message],
            };
          }),
        })),

      addToolMessages: (sessionId, items) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const now = Date.now();
            const msgs: Message[] = items.map((it) => ({
              id: it.id ?? uid(),
              role: 'system',
              content: it.content,
              timestamp: it.timestamp ?? now,
              ...(it.model !== undefined ? { model: it.model } : {}),
              ...(it.provider !== undefined ? { provider: it.provider } : {}),
              ...(it.tokens !== undefined ? { tokens: it.tokens } : {}),
              ...(it.images !== undefined ? { images: it.images } : {}),
              ...(it.toolCalls !== undefined ? { toolCalls: it.toolCalls } : {}),
              ...(it.toolCallId !== undefined ? { toolCallId: it.toolCallId } : {}),
              ...(it.toolName !== undefined ? { toolName: it.toolName } : {}),
              ...(it.isError !== undefined ? { isError: it.isError } : {}),
              ...(it.reasoning !== undefined ? { reasoning: it.reasoning } : {}),
              ...(it.thinking !== undefined ? { thinking: it.thinking } : {}),
            }));
            return { ...sess, updatedAt: now, messages: [...sess.messages, ...msgs] };
          }),
        })),

      appendToolCalls: (sessionId, assistantId, calls) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            return {
              ...sess,
              updatedAt: Date.now(),
              messages: sess.messages.map((m) =>
                m.id === assistantId && m.role === 'assistant'
                  ? { ...m, toolCalls: [...(m.toolCalls ?? []), ...calls] }
                  : m,
              ),
            };
          }),
        })),

      updateLastMessage: (sessionId, content) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const last = sess.messages[sess.messages.length - 1];
            if (!last || last.role !== 'assistant') {
              const settings = useSettingsStore.getState();
              const fresh: Message = {
                id: uid(),
                role: 'assistant',
                content,
                timestamp: Date.now(),
                model: sess.model || settings.currentModel,
                provider: sess.provider,
              };
              return { ...sess, updatedAt: Date.now(), messages: [...sess.messages, fresh] };
            }
            const updated: Message = { ...last, content: last.content + content };
            return {
              ...sess,
              updatedAt: Date.now(),
              messages: [...sess.messages.slice(0, -1), updated],
            };
          }),
        })),

      appendToMessage: (sessionId, messageId, content) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            const idx = sess.messages.findIndex((m) => m.id === messageId);
            if (idx === -1) {
              // Hedef mesaj yok (silinmiş olabilir) → yeni assistant mesajı aç.
              const settings = useSettingsStore.getState();
              const fresh: Message = {
                id: messageId,
                role: 'assistant',
                content,
                timestamp: Date.now(),
                model: sess.model || settings.currentModel,
                provider: sess.provider,
              };
              return { ...sess, updatedAt: Date.now(), messages: [...sess.messages, fresh] };
            }
            const target = sess.messages[idx];
            const updated: Message = { ...target, content: target.content + content };
            return {
              ...sess,
              updatedAt: Date.now(),
              messages: [...sess.messages.slice(0, idx), updated, ...sess.messages.slice(idx + 1)],
            };
          }),
        })),

      setCompaction: (sessionId, compaction) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            if (!compaction) {
              const { compaction: _drop, ...rest } = sess;
              return { ...rest, updatedAt: Date.now() };
            }
            return { ...sess, compaction, updatedAt: Date.now() };
          }),
        })),

      clearSession: (sessionId) =>
        set((s) => ({
          sessions: s.sessions.map((sess) => {
            if (sess.id !== sessionId) return sess;
            // Faz 12 B.6: sıfırlamada özet de düşer (eski bağlamın izi kalmasın).
            const { compaction: _drop, ...rest } = sess;
            return { ...rest, messages: [], updatedAt: Date.now() };
          }),
        })),

      removeMessage: (sessionId, messageId) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  updatedAt: Date.now(),
                  messages: sess.messages.filter((m) => m.id !== messageId),
                }
              : sess,
          ),
        })),

      updateSessionModel: (sessionId, patch) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  ...(patch.provider !== undefined ? { provider: patch.provider } : null),
                  ...(patch.model !== undefined ? { model: patch.model } : null),
                  updatedAt: Date.now(),
                }
              : sess,
          ),
        })),

      setMessageUsage: (sessionId, messageId, usage) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  updatedAt: Date.now(),
                  messages: sess.messages.map((m) =>
                    m.id === messageId ? { ...m, tokens: { ...usage } } : m,
                  ),
                }
              : sess,
          ),
        })),

      appendReasoning: (sessionId, messageId, delta) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  updatedAt: Date.now(),
                  messages: sess.messages.map((m) =>
                    m.id === messageId && m.role === 'assistant'
                      ? { ...m, reasoning: `${m.reasoning ?? ''}${delta}` }
                      : m,
                  ),
                }
              : sess,
          ),
        })),

      setAssistantThinking: (sessionId, messageId, blocks) =>
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  updatedAt: Date.now(),
                  messages: sess.messages.map((m) =>
                    m.id === messageId && m.role === 'assistant'
                      ? { ...m, thinking: blocks.map((b) => ({ ...b })) }
                      : m,
                  ),
                }
              : sess,
          ),
        })),

      setStreaming: (value) => set({ isStreaming: value }),

      getActiveSession: () => {
        const { sessions, activeSessionId } = get();
        return sessions.find((sess) => sess.id === activeSessionId) ?? null;
      },
    }),
    {
      name: 'macrocode-sessions',
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : noopStorage,
      ),
      partialize: (s) => ({ sessions: s.sessions, activeSessionId: s.activeSessionId }),
    },
  ),
);
