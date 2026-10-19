import { useCallback, useRef } from 'react';
import {
  buildAgentHistory,
  createAgentRun,
  type AgentRun,
  type AgentHistoryItem,
  type AgentRunState,
} from '../lib/engine/agent';
import { listApprovals, queueApproval, takeApproval } from '../lib/engine/approvals';
import { parseCustomAllowList } from '../lib/engine/policy';
import { supportsTools } from '../lib/engine/providers';
import { createId, useSessionStore } from '../store/session';
import { useSettingsStore } from '../store/settings';
import { useWorkspaceStore } from '../store/workspace';
import { apiKeyFor, providerNeedsKey } from './useStream';
import { formatProviderError } from '../lib/providers/common';
import { PROVIDER_IDS, resolveModels } from '../lib/providers';
import { budgetFor } from '../lib/engine/tokens';
import { compactHistory, shouldCompact } from '../lib/engine/compact';
import { applyMemo, memoToPersisted, resolveMemo, setMemo } from '../lib/engine/compactionMemo';
import { buildRepoContext } from '../lib/engine/repoContext';
import { logError, logInfo } from '../lib/logger';
import { promptCacheKey } from '../lib/providers/promptCache';
import { deriveTodoState } from '../lib/engine/tools/todo';
import { listSkills, skillsPrompt } from '../lib/engine/skills';
import { configureMcp, mcpToolsForAgent } from '../lib/engine/mcp/pool';
import { makeSummarizeFn, summarizerConfig } from '../lib/summarize';
import type { Provider, ToolEvent } from '../types';
import type { AgentEvent, ToolCall, ToolDefinition } from '../lib/engine/types';

export interface AgentToolLine {
  type: 'sys' | 'err' | 'warn';
  content: string;
  /** Varsa satır yapılandırılmış bir araç çağrısıdır (kart render edilir). */
  tool?: ToolEvent;
}

/** Faz 1 G2/G5: oturum başına aktif run (onayda durur, resolve ile devam eder). */
const activeRuns = new Map<string, AgentRun>();

export function getActiveAgentRun(sessionId: string): AgentRun | undefined {
  return activeRuns.get(sessionId);
}

/** Araç argümanlarının tek satırlık önizlemesi. */
function previewArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (v === undefined || v === null) continue;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    parts.push(`${k}=${s.length > 60 ? s.slice(0, 60) + '…' : s}`);
  }
  return parts.join(' ');
}

/** Araç çıktısı önizlemesi (tek satır, uzun çıktı kırpılır). */
function previewOutput(out: string, limit = 220): string {
  const flat = out.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '(boş)';
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

/**
 * Faz 7 A3: agent'ın yazdığı asistan mesajı artık "son assistant" değil,
 * **tur başına sabit hedef** (tool sonuçları araya girdiğinde cevap parçalanıyordu).
 */

/**
 * Faz 12 B.8 — ortak run olay işleyicisi.
 *
 * Hem yeni turda hem de **geri yüklenen** (restart sonrası) turda agent'ın
 * çıktısı aynı assistant mesajına yazılmalı → tek yerden.
 */
function makeRunEventHandler(opts: {
  sessionId: string;
  assistantId: string;
  callNames: Map<string, string>;
  emit: (line: AgentToolLine) => void;
}) {
  const { sessionId, assistantId, callNames, emit } = opts;
  const store = useSessionStore.getState;
  return (e: AgentEvent) => {
    if (e.k === 'text' && e.delta) {
      // Faz 7 A3: hedef mesaj sabit (tool sonrası "son mesaj" kuralı
      // cevabı parçalamıştı) — tur başına tek assistant mesajı.
      store().appendToMessage(sessionId, assistantId, e.delta);
    } else if (e.k === 'reasoning' && e.delta) {
      try {
        store().appendReasoning(sessionId, assistantId, e.delta);
      } catch {
        // store hatası akışı durdurmaz
      }
    } else if (e.k === 'thinking' && e.blocks.length > 0) {
      try {
        store().setAssistantThinking(sessionId, assistantId, e.blocks);
      } catch {
        // yoksay
      }
    } else if (e.k === 'done' && e.usage) {
      try {
        store().setMessageUsage(sessionId, assistantId, e.usage);
      } catch {
        // yoksay
      }
    } else if (e.k === 'tool_call') {
      callNames.set(e.call.id, String(e.call.name));
      try {
        store().appendToolCalls(sessionId, assistantId, [
          { id: e.call.id, name: String(e.call.name), args: e.call.args as Record<string, unknown> },
        ]);
      } catch {
        // store hatası akışı durdurmaz
      }
      emit({
        type: 'sys',
        content: `/// tool ▸ ${e.call.name} ${JSON.stringify(e.call.args).slice(0, 160)}`,
        tool: {
          id: String(e.call.id),
          name: String(e.call.name),
          args: previewArgs(e.call.args as Record<string, unknown>),
          status: 'run',
        },
      });
    } else if (e.k === 'tool_preview') {
      emit({ type: 'sys', content: `/// önizleme (${e.id.slice(0, 8)}):\n${e.output.slice(0, 800)}` });
    } else if (e.k === 'tool_result') {
      const toolName = callNames.get(e.id);
      try {
        store().addToolMessages(sessionId, [
          {
            role: 'system',
            content: e.output.slice(0, 4000),
            toolCallId: e.id,
            ...(toolName ? { toolName } : {}),
            isError: !e.ok,
          },
        ]);
      } catch {
        // yoksay
      }
      if (toolName) {
        // Yapılandırılmış araç kartı (çağrı + sonuç tek kartta birleşir).
        emit({
          type: e.ok ? 'sys' : 'err',
          content: e.ok
            ? `▸ ${toolName}: ${previewOutput(e.output)}`
            : `✗ araç hatası (${e.id.slice(0, 8)}): ${e.output.slice(0, 300)}`,
          tool: {
            id: String(e.id),
            name: toolName,
            args: '',
            status: e.ok ? 'ok' : 'err',
            output: e.output.slice(0, 4000),
          },
        });
      } else if (!e.ok) {
        emit({ type: 'err', content: `✗ araç hatası (${e.id.slice(0, 8)}): ${e.output.slice(0, 300)}` });
      }
    }
  };
}

/**
 * Agent'lı gönderim (Faz 1: duraklatılabilir run + kalıcı onay).
 * Sözleşme useStream ile aynı: başarı/abort -> null, hata -> err satırı.
 */
export function useAgent() {
  const abortRef = useRef<AbortController | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    for (const run of activeRuns.values()) run.abort();
  }, []);

  const sendAgent = useCallback(
    async (
      text: string,
      onToolLine?: (line: AgentToolLine) => void,
      images?: string[],
      onPending?: (pending: ToolCall[]) => void,
    ): Promise<string | null> => {
      const trimmed = text.trim();
      if (!trimmed && (!images || images.length === 0)) return null;
      if (useSessionStore.getState().isStreaming) return null;

      let session = useSessionStore.getState().getActiveSession();
      if (!session) session = useSessionStore.getState().createSession();
      const sessionId = session.id;
      const store = useSessionStore.getState;
      const settings = useSettingsStore.getState();
      const ws = useWorkspaceStore.getState();

      if (!ws.root) {
        return '✗ workspace seçilmedi · /root ile klasör seç';
      }
      if (settings.activeEndpointId) {
        return '✗ özel uçlar agent modunu desteklemiyor · ayarlardan yerleşik akışa dön';
      }

      const providerName: Provider = session.provider ?? settings.currentProvider;
      const model = session.model || settings.currentModel;
      if (!supportsTools(providerName, model, settings.customModels)) {
        return `✗ ${providerName}/${model} agent modunu desteklemiyor · /provider ${PROVIDER_IDS.join('|')} dene veya tools destekli modele geç`;
      }
      const apiKey = apiKeyFor(providerName, settings.apiKeys);
      if (providerNeedsKey(providerName) && !apiKey.trim()) {
        return '✗ api anahtarı eksik · /key ile ekleyebilirsin';
      }

      const userId = createId();
      const assistantId = createId();
      const now = Date.now();
      store().setStreaming(true);
      store().addMessage(sessionId, {
        id: userId,
        role: 'user',
        content: trimmed,
        timestamp: now,
        model,
        provider: providerName,
        ...(images && images.length > 0 ? { images: [...images] } : {}),
      });
      store().addMessage(sessionId, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: now,
        model,
        provider: providerName,
      });

      // Faz 7: compaction hafızası varsa geçmiş = "özet + o özetten sonraki mesajlar".
      // (Aynı özet her turda yeniden yapılmaz.)
      const sessionMessages = useSessionStore.getState().sessions.find((s) => s.id === sessionId)
        ?.messages ?? [];
      const rawHistory = buildAgentHistory(sessionMessages, assistantId);
      // Faz 12 B.6: bellekte yoksa oturumdaki kalıcı kopya (restart sonrası).
      const memo = resolveMemo<AgentHistoryItem>(sessionId, session.compaction);
      const history: AgentHistoryItem[] = applyMemo(memo, rawHistory);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const callNames = new Map<string, string>();

      try {
        const emit = (line: AgentToolLine) => onToolLine?.(line);
        // Faz 5: MCP bağlamı + araçları (düşen sunucu sessizce atlanır).
        configureMcp({ servers: settings.mcpServers, secrets: settings.mcpSecrets, root: ws.root });
        let extraTools: ToolDefinition[] = [];
        try {
          extraTools = await mcpToolsForAgent();
          if (settings.mcpServers.some((s) => s.enabled) && extraTools.length === 0) {
            emit({ type: 'warn', content: '! mcp: etkin sunuculara ulaşılamadı · yerleşik araçlarla devam' });
          }
        } catch {
          extraTools = [];
        }
        // Faz 2: gönderim öncesi otomatik compaction (user mesajı tura dahil).
        let effHistory = history;
        try {
          const budget = budgetFor(model, settings.customModels);
          if (shouldCompact(history, budget)) {
            const cfg = summarizerConfig({
              currentProvider: providerName,
              currentModel: model,
              summarizerProvider: settings.summarizerProvider,
              summarizerModel: settings.summarizerModel,
              apiKeys: settings.apiKeys,
              customModels: settings.customModels,
              baseUrlOverride: settings.baseUrlOverride,
            });
            if (cfg) {
              const compacted = await compactHistory({
                history,
                budget,
                summarize: makeSummarizeFn(cfg),
              });
              if (compacted !== history) {
                effHistory = compacted;
                // Hafızaya yaz: sonraki turlarda aynı özet tekrar yapılmaz.
                // Faz 9 P9.5: kesim id tabanlı olsun (zaman damgası riski).
                const memoForm = {
                  at: Date.now(),
                  items: compacted,
                  coveredIds: history
                    .map((h) => h.id)
                    .filter((x): x is string => typeof x === 'string'),
                };
                setMemo(sessionId, memoForm.at, compacted, {
                  coveredIds: memoForm.coveredIds,
                });
                // Faz 12 B.6: özet oturuma kalıcı yazılır (restart sonrası tekrar özetlenmez).
                store().setCompaction(sessionId, memoToPersisted(memoForm));
                emit({ type: 'sys', content: '/// context özetlendi (compaction)' });
              }
            }
          }
        } catch {
          effHistory = history;
        }
        // Faz 7 denetimi: kullanıcı mesajı oturum geçmişinde **zaten var**
        // (buildAgentHistory son mesaj olarak alır) — ikinci kez eklenmiyor.
        const historyWithUser = effHistory;
        // Faz 3: aktif todo listesi system prompt'a eklenir.
        const todoState = deriveTodoState(history);
        const todoBlock =
          todoState.items.length > 0
            ? `\n[todo]\n${todoState.items.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.id} ${t.text}`).join('\n')}`
            : '';
        // Faz 9 P9.1–P9.3: repo bağlamı (harita + AGENTS.md/README + kalıcı hafıza).
        // Önbellekli: aynı workspace'te her turda yeniden hazırlanmaz.
        let projectBlock = '';
        try {
          const repoCtx = await buildRepoContext(ws.root, {
            model,
            customModels: settings.customModels,
          });
          projectBlock = repoCtx.text;
          if (repoCtx.error) {
            emit({
              type: 'warn',
              content: `! repo bağlamı okunamadı: ${repoCtx.error.slice(0, 160)}`,
            });
          }
        } catch {
          // Bağlam hazırlanamazsa agent yine çalışır (tool keşfi ile).
        }
        const run = createAgentRun(historyWithUser, {
          provider: providerName,
          apiKey,
          model,
          systemPrompt:
            [
              session.systemPrompt || settings.systemPrompt || '',
              // Faz 8 L5: skill registry'sindeki talimatlar modele ulaşır
              // (önceden `skillsPrompt` hiç çağrılmıyordu).
              skillsPrompt(listSkills().map((sk) => sk.name)),
              // Faz 9: proje haritası + anahtar dosyalar + kalıcı notlar.
              projectBlock,
              `[workspace:${ws.label || ws.root}]${todoBlock}`,
            ]
              .filter(Boolean)
              .join('\n')
              .trim() || undefined,
          workspaceRoot: ws.root,
          approvalMode: ws.approvalMode,
          signal: ctrl.signal,
          params: settings.modelParams[model],
          registry: resolveModels(settings.customModels),
          // Faz 11: prompt cache (agent döngüsünde en çok kazanç burada).
          ...(settings.cachePrompts !== false
            ? { cachePrompts: true, promptCacheKey: promptCacheKey(sessionId, model) }
            : {}),
          extraTools,
          extraAllow: parseCustomAllowList(settings.customAllowList),
          // Faz 8 L1: alt-agent kendi compaction'ı için özetleyici (yoksa kısaltma).
          summarize: async (transcript: string) => {
            const cfg = summarizerConfig({
              currentProvider: providerName,
              currentModel: model,
              summarizerProvider: settings.summarizerProvider,
              summarizerModel: settings.summarizerModel,
              apiKeys: settings.apiKeys,
              customModels: settings.customModels,
              baseUrlOverride: settings.baseUrlOverride,
            });
            if (!cfg) return transcript.slice(0, 1200);
            return makeSummarizeFn(cfg)(transcript);
          },
          ...(settings.auditEnabled ? { auditSessionId: sessionId } : {}),
          onEvent: makeRunEventHandler({
            sessionId,
            assistantId,
            callNames,
            emit,
          }),
        });
        activeRuns.set(sessionId, run);
        logInfo('agent.run.start', { provider: providerName, model, messages: historyWithUser.length });
        const result = await run.step();
        if (result.kind === 'needs-approval') {
          // Faz 12 B.8: run durumu kalıcı yazılır → uygulama yeniden başlatıldığında
          // bekleyen iş kaldığı yerden sürülür (eskiden "yeniden başlatılamadı").
          const runState = run.serialize();
          for (const call of result.pending) {
            await queueApproval({
              id: call.id,
              sessionId,
              call,
              createdAt: Date.now(),
              runState,
            });
          }
          onPending?.(result.pending);
          emit({
            type: 'sys',
            content: `⏸ onay bekleniyor: ${result.pending.map((c) => `${c.name}`).join(' · ')} [Enter onayla / Esc reddet]`,
          });
          return null;
        }
        activeRuns.delete(sessionId);
        logInfo('agent.run.done', { provider: providerName, model, kind: result.kind });
        // Faz 7 A3: boş placeholder'ı id ile bul (tool mesajları araya girdiği
        // için "son mesaj" kontrolü artık geçerli değil).
        const msgs = store().getActiveSession()?.messages ?? [];
        const mine = msgs.find((m) => m.id === assistantId);
        if (mine && mine.content === '') {
          store().removeMessage(sessionId, assistantId);
          return '✗ agent boş döndü · farklı ifade dene';
        }
        return null;
      } catch (err) {
        activeRuns.delete(sessionId);
        logError('agent.run.error', {
          provider: providerName,
          model,
          error: err instanceof Error ? err.message : String(err),
        });
        if (ctrl.signal.aborted) return null;
        const msgs = store().getActiveSession()?.messages ?? [];
        const mine = msgs.find((m) => m.id === assistantId);
        if (mine && mine.content === '') {
          store().removeMessage(sessionId, assistantId);
        }
        return formatProviderError(err);
      } finally {
        const stillPending = activeRuns.has(sessionId);
        if (!stillPending) {
          store().setStreaming(false);
          if (abortRef.current === ctrl) abortRef.current = null;
        }
      }
    },
    [],
  );

  const resolvePending = useCallback(
    async (
      sessionId: string,
      decisions: Array<{ id: string; approved: boolean }>,
      onToolLine?: (line: AgentToolLine) => void,
      onPending?: (pending: ToolCall[]) => void,
    ): Promise<string | null> => {
      const run = activeRuns.get(sessionId);
      if (!run) {
        // Bellekte run yok (restart) — patch apply yine çalışır, agent devam etmez.
        for (const d of decisions) {
          const queued = await takeApproval(d.id);
          if (queued && d.approved) {
            onToolLine?.({ type: 'sys', content: '/// onay bekleyen iş yeniden başlatılamadı · yeniden iste' });
          }
        }
        return '/// onay bekleyen iş yeniden başlatılamadı · yeniden iste';
      }
      const store = useSessionStore.getState;
      const callNames = new Map<string, string>();
      // Karar öncesi kuyruğu düşür.
      for (const d of decisions) {
        await takeApproval(d.id);
        if (!d.approved) {
          onToolLine?.({ type: 'sys', content: `[✗] reddedildi: ${d.id.slice(0, 8)}` });
        } else {
          onToolLine?.({ type: 'sys', content: `[✓] onaylandı: ${d.id.slice(0, 8)}` });
        }
      }
      try {
        // resolve içindeki olayları kalıcı katmana yansıtmak için run'ın onEvent'i zaten bağlı;
        // burada ek satırlar için geçici dinleyici yeterli (run içi emit App'e gider).
        const result = await run.resolve(decisions);
        void callNames;
        if (result.kind === 'needs-approval') {
          for (const call of result.pending) {
            await queueApproval({ id: call.id, sessionId, call, createdAt: Date.now() });
          }
          onPending?.(result.pending);
          onToolLine?.({
            type: 'sys',
            content: `⏸ onay bekleniyor: ${result.pending.map((c) => `${c.name}`).join(' · ')} [Enter onayla / Esc reddet]`,
          });
          return null;
        }
        activeRuns.delete(sessionId);
        store().setStreaming(false);
        return null;
      } catch (err) {
        activeRuns.delete(sessionId);
        store().setStreaming(false);
        return formatProviderError(err);
      }
    },
    [],
  );

  /**
   * Faz 12 B.8 — bekleyen onaylı işleri geri yükler.
   *
   * Uygulama yeniden başlatıldığında `pending_approvals.run_state` içindeki agent
   * durumu okunur ve tur kaldığı yerden sürülür (eskiden "yeniden başlatılamadı").
   * Dönen sayı: geri yüklenen oturum sayısı.
   */
  const restorePendingRuns = useCallback(async (): Promise<number> => {
    const settings = useSettingsStore.getState();
    const ws = useWorkspaceStore.getState();
    if (!ws.root) return 0;
    const store = useSessionStore.getState;
    let restored = 0;
    let approvals: Awaited<ReturnType<typeof listApprovals>> = [];
    try {
      approvals = await listApprovals();
    } catch {
      return 0;
    }
    for (const a of approvals) {
      if (activeRuns.has(a.sessionId)) continue;
      if (!a.runState) continue;
      let state: AgentRunState;
      try {
        state = JSON.parse(a.runState) as AgentRunState;
      } catch {
        continue;
      }
      if (!state || !Array.isArray(state.msgs) || state.msgs.length === 0) continue;
      const sess = store().sessions.find((s) => s.id === a.sessionId);
      if (!sess) continue;
      const providerName: Provider = sess.provider ?? settings.currentProvider;
      const model = sess.model || settings.currentModel;
      const apiKey = apiKeyFor(providerName, settings.apiKeys);
      if (providerNeedsKey(providerName) && !apiKey.trim()) continue;

      // MCP araçları (yeniden bağlan).
      let extraTools: ToolDefinition[] = [];
      try {
        configureMcp({ servers: settings.mcpServers, secrets: settings.mcpSecrets, root: ws.root });
        extraTools = await mcpToolsForAgent();
      } catch {
        extraTools = [];
      }

      // Çıktının yazılacağı assistant mesajı (yoksa yeni placeholder).
      const msgs = store().sessions.find((s) => s.id === a.sessionId)?.messages ?? [];
      let assistantId = '';
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].role === 'assistant') {
          assistantId = msgs[i].id;
          break;
        }
      }
      if (!assistantId) {
        assistantId = createId();
        store().addMessage(a.sessionId, {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          model,
          provider: providerName,
        });
      }

      const callNames = new Map<string, string>();
      const run = createAgentRun(
        state.msgs,
        {
          provider: providerName,
          apiKey,
          model,
          systemPrompt:
            `${sess.systemPrompt || settings.systemPrompt || ''}\n[workspace:${ws.label || ws.root}]`.trim() ||
            undefined,
          workspaceRoot: ws.root,
          approvalMode: ws.approvalMode,
          params: settings.modelParams[model],
          registry: resolveModels(settings.customModels),
          extraTools,
          extraAllow: parseCustomAllowList(settings.customAllowList),
          ...(settings.auditEnabled ? { auditSessionId: a.sessionId } : {}),
          ...(settings.cachePrompts !== false
            ? { cachePrompts: true, promptCacheKey: promptCacheKey(a.sessionId, model) }
            : {}),
          onEvent: makeRunEventHandler({
            sessionId: a.sessionId,
            assistantId,
            callNames,
            emit: () => {},
          }),
        },
        state,
      );
      activeRuns.set(a.sessionId, run);
      restored += 1;
      logInfo('agent.run.restored', { sessionId: a.sessionId, provider: providerName, model });
    }
    return restored;
  }, []);

  return { sendAgent, resolvePending, restorePendingRuns, abort };
}
