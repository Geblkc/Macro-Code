/**
 * Faz F — Agent loop.
 * UI'dan bağımsız: provider stream + tool koşucular enjekte edilebilir (test için).
 */
import { getProvider } from '../providers';
import { appendAudit } from '../db';
import type { ChatItem, StreamChunk } from '../providers/common';
import { mergeUsage, sumUsage, withRetry } from '../providers/common';
import type { TokenUsage } from '../providers/common';
import type { AgentMode, Message, Model, ModelParams, Provider } from '../../types';
import { CORE_TOOLS, strArg } from './toolspec';
import { filterToolsForMode, getDisallowedToolsForMode } from './agentModes';
import type { AgentEvent, ApprovalMode, ToolCall, ToolDefinition, UsageLike } from './types';
import { decideTool } from './policy';
import { t } from '../i18n/core';
import { runFsTool } from './tools/fs';
import { applyPendingPatch, listPending, toolEditFile, toolProposePatch, undoLastPatch } from './tools/patch';
import { toolWriteFile } from './tools/write';
import { applyTodoAction, deriveTodoState, planStepIds } from './tools/todo';
import { runMcpTool } from './mcp/pool';
import { runSubagent } from './subagent';
import { toolExec } from './tools/shell';

export interface AgentHistoryItem {
  role: string;
  content: string;
  /** Mesajın zaman damgası (compaction hafızası: yeni mesajları ayırmak için). */
  ts?: number;
  /** Kaynak mesajın id'si (yinelenen mesaj denetimi için). */
  id?: string;
  images?: string[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /** Faz 4: imzalı thinking blokları (Anthropic geri gönderimi için). */
  thinking?: Array<{ thinking: string; signature: string }>;
}

export interface AgentDeps {
  provider: Provider;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  workspaceRoot: string;
  approvalMode?: ApprovalMode;
  maxSteps?: number;
  signal?: AbortSignal;
  params?: ModelParams;
  /** İş 3: registry + özel modeller — maxOutput/capability kararları buradan. */
  registry?: Model[];
  onEvent: (e: AgentEvent) => void;
  /** Test enjeksiyonu: provider stream yerine geçer. */
  streamImpl?: (cfg: {
    messages: ChatItem[];
    tools: typeof CORE_TOOLS;
    onChunk: (c: StreamChunk) => void;
    signal?: AbortSignal;
  }) => Promise<void>;
  /** Test enjeksiyonu: fs/shell koşucuları. */
  runToolImpl?: (call: ToolCall) => Promise<string>;
  /** Faz 5: çekirdek setine eklenen araçlar (MCP registry). */
  extraTools?: ToolDefinition[];
  /** Agent modu: build | plan | ask (araç erişimini ve yönergeleri etkiler). */
  agentMode?: AgentMode;
  /** Faz 5b: bu listedeki araçlar çalıştırılmaz (salt-okunur alt-agent). */
  disallowTools?: string[];
  /** Faz 5b: alt-agent bütçesi için özel modeller (verilmezse registry). */
  customModels?: import('../../types').CustomModel[];
  /** Faz 6: kullanıcı allowlist uzantısı (parseCustomAllowList çıktısı). */
  extraAllow?: Record<string, string[][]>;
  /** Faz 6: doluysa her tool kararı audit_log'a yazılır. */
  auditSessionId?: string;
  /**
   * Faz 11: prompt cache — agent döngüsünde en büyük maliyet kalemi budur
   * (sistem prompt'u + geçmiş her turda yeniden gönderilir).
   */
  cachePrompts?: boolean;
  /** Oturuma bağlı önbellek anahtarı (OpenAI-uyumlu sağlayıcılar). */
  promptCacheKey?: string;
  /**
   * Faz 8 L1: alt-agent'ın kendi compaction'ı için özetleyici.
   * Verilmezse alt-agent geçmişi kısaltılmadan (özetleme yapılmadan) çalışır.
   */
  summarize?: (transcript: string) => Promise<string>;
}

/**
 * Oturum mesajlarından provider'a gönderilecek agent geçmişini kurar (saf fonksiyon).
 *
 * Faz 7 denetimi: bu kurucu `useAgent` içinde gömülüydü ve **kullanıcı mesajı
 * hem geçmişte hem de `historyWithUser` ile ikinci kez ekleniyordu** → provider
 * isteğinde aynı mesaj iki kez görünüyordu. Artık geçmiş **bir kez** kurulur.
 *
 * - Boş içerikli mesajlar (ör. boş assistant placeholder) atlanır.
 * - Kesmede kopan tool çifti geriye taranarak tamamlanır.
 * - `ts` ve `id` taşınır (compaction hafızası + yinelenen mesaj denetimi).
 */
export const AGENT_HISTORY_MAX_MESSAGES = 200;

export function buildAgentHistory(
  messages: Message[],
  excludeAssistantId: string,
): AgentHistoryItem[] {
  const all = messages.filter(
    (m) =>
      m.id !== excludeAssistantId &&
      (m.content.length > 0 || (m.images?.length ?? 0) > 0 || (m.toolCalls?.length ?? 0) > 0),
  );
  // Kesme + tool çifti kopmaması için geriye tarama.
  let sliced = all.slice(-AGENT_HISTORY_MAX_MESSAGES);
  if (sliced.length > 0 && all.length > sliced.length) {
    const first = sliced[0];
    if (first.role === 'system' && first.toolCallId) {
      const idx = all.findIndex((m) => m.id === first.id);
      if (idx > 0) {
        const prev = all[idx - 1];
        if (prev.role === 'assistant' && prev.toolCalls?.some((c) => c.id === first.toolCallId)) {
          sliced = [prev, ...sliced];
        }
      }
    }
  }
  return sliced.map((m) => ({
    role: m.role === 'system' && m.toolCallId ? 'tool' : m.role,
    content: m.content,
    ts: m.timestamp,
    id: m.id,
    ...(m.images && m.images.length > 0 ? { images: [...m.images] } : {}),
    ...(m.toolCalls?.length ? { toolCalls: m.toolCalls.map((c) => ({ ...c })) } : {}),
    ...(m.thinking?.length ? { thinking: m.thinking.map((t) => ({ ...t })) } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId, toolName: m.toolName } : {}),
    ...(m.isError !== undefined ? { isError: m.isError } : {}),
  }));
}

export function toProviderMessages(history: AgentHistoryItem[]): ChatItem[] {
  // C.6: yarım tool çiftleri provider 400 üretir — eşleşmeyeni temizle.
  const callIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const m of history) {
    if (m.toolCalls) for (const c of m.toolCalls) callIds.add(c.id);
    if (m.role === 'tool' && m.toolCallId) resultIds.add(m.toolCallId);
  }
  const out: ChatItem[] = [];
  for (const m of history) {
    const hasText = m.content.trim().length > 0;
    const hasImages = (m.images?.length ?? 0) > 0;
    const hasCalls = (m.toolCalls?.length ?? 0) > 0;
    const hasThinking = (m.thinking?.length ?? 0) > 0;
    if (!hasText && !hasImages && !hasCalls && !hasThinking && m.role !== 'tool') continue;
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const matched = m.toolCalls.filter((c) => resultIds.has(c.id));
      if (matched.length === 0) {
        // Sonuçsuz çağrı (eski/kayıp veya henüz resolve edilmemiş pending):
        // provider 400 üretmemesi için tool listesini düşür, metin varsa koru.
        if (!hasText && !hasImages) continue;
        out.push({
          role: m.role,
          content: m.content,
          ...(hasImages ? { images: [...m.images!] } : {}),
          ...(m.thinking?.length ? { thinking: [...m.thinking] } : {}),
        });
        continue;
      }
      out.push({
        role: m.role,
        content: m.content,
        ...(hasImages ? { images: [...m.images!] } : {}),
        toolCalls: [...matched],
        ...(m.thinking?.length ? { thinking: [...m.thinking] } : {}),
        ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
        ...(m.toolName ? { toolName: m.toolName } : {}),
        ...(m.isError !== undefined ? { isError: m.isError } : {}),
      });
      continue;
    }
    if (m.role === 'tool') {
      if (m.toolCallId && !callIds.has(m.toolCallId)) {
        // Eşleşmeyen tool sonucu → user mesajına çevir (C.6).
        // Not: modele giden metin — İngilizce (toolspec ile aynı politika).
        out.push({ role: 'user', content: `[tool result] ${m.content}` });
        continue;
      }
    }
    out.push({
      role: m.role,
      content: m.content,
      ...(m.images && m.images.length > 0 ? { images: [...m.images] } : {}),
      ...(m.toolCalls && m.toolCalls.length > 0 ? { toolCalls: [...m.toolCalls] } : {}),
      ...(m.thinking && m.thinking.length > 0 ? { thinking: [...m.thinking] } : {}),
      ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
      ...(m.toolName ? { toolName: m.toolName } : {}),
      ...(m.isError !== undefined ? { isError: m.isError } : {}),
    });
  }
  return out;
}

async function defaultRunTool(
  root: string,
  mode: ApprovalMode,
  call: ToolCall,
  history: AgentHistoryItem[] = [],
  opts?: {
    /** Y2 (Faz 3): yalnızca `resolve` bu bayrağı true geçirir — exec'in
     *  çalıştırılabilmesi için kullanıcının onay ekranından geçmiş olması şart. */
    approved?: boolean;
    extraAllow?: Record<string, string[][]>;
  },
): Promise<string> {
  if (
    call.name === 'read_file' ||
    call.name === 'list_dir' ||
    call.name === 'grep' ||
    call.name === 'glob'
  ) {
    return runFsTool(root, call);
  }
  if (call.name === 'propose_patch') {
    return toolProposePatch(root, call);
  }
  if (call.name === 'edit_file') {
    return toolEditFile(root, call);
  }
  if (call.name === 'write_file') {
    return toolWriteFile(root, call);
  }
  if (call.name === 'todo') {
    return applyTodoAction(deriveTodoState(history), call.args).output;
  }
  if (call.name === 'plan') {
    const steps = Array.isArray(call.args.steps)
      ? (call.args.steps as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      : [];
    if (steps.length === 0) throw new Error(t('tool.planSteps'));
    // Faz 8 L2: adımlar görev id'leriyle eşleşir (todo ile işaretlenebilir).
    const ids = planStepIds(call, 0);
    return `/// plan:\n${steps.map((s, i) => `${i + 1}. ${s.trim()}  [todo: ${ids[i]}]`).join('\n')}`;
  }
  if (typeof call.name === 'string' && call.name.startsWith('mcp:')) {
    return runMcpTool(call);
  }
  if (call.name === 'exec') {
    return toolExec(root, call, mode, {
      approved: opts?.approved,
      extraAllow: opts?.extraAllow,
    });
  }
  throw new Error(`bilinmeyen araç: ${call.name}`);
}

/**
 * Faz 8 L1 — alt-agent aracı: salt-okunur keşif görevi.
 * Alt-agent kendi bütçesiyle çalışır, yazma araçları kapalıdır ve koordinatöre
 * tek bir metin döner. `disallowTools` sayesinde özyineleme yoktur.
 */
async function runSubagentTool(
  deps: AgentDeps,
  call: ToolCall,
  msgs: AgentHistoryItem[],
): Promise<string> {
  const task = strArg(call.args, 'task', '');
  if (!task.trim()) throw new Error(t('tool.subagentTask'));
  const summarize = deps.summarize ?? (async (t: string) => t.slice(0, 800));
  const res = await runSubagent(task, msgs, { ...deps, summarize });
  return res.text.trim() || t('tool.subagentEmpty');
}

/**
 * Bir tool çağrısını çalıştırır (alt-agent meta-aracı dahil).
 * `runToolImpl` (test enjeksiyonu) normal araçlar için kullanılır.
 */
async function executeTool(
  deps: AgentDeps,
  mode: ApprovalMode,
  call: ToolCall,
  msgs: AgentHistoryItem[],
): Promise<string> {
  if (call.name === 'subagent') {
    return runSubagentTool(deps, call, msgs);
  }
  if (deps.runToolImpl) return deps.runToolImpl(call);
  return defaultRunTool(deps.workspaceRoot, mode, call, msgs, { extraAllow: deps.extraAllow });
}

// ── Faz 1 G2: duraklatılabilir agent döngüsü (K2 reddet+devam) ─────────────

export type AgentStepResult =
  | { kind: 'done'; text: string; steps: number; usage?: UsageLike }
  | { kind: 'needs-approval'; pending: ToolCall[] };

export interface AgentRun {
  step(): Promise<AgentStepResult>;
  resolve(decisions: Array<{ id: string; approved: boolean }>): Promise<AgentStepResult>;
  serialize(): string;
  abort(): void;
}

interface PendingEntry {
  call: ToolCall;
  /** patch önizlemesi üretildiyse ilgili PendingPatch id'si (apply için). */
  patchId?: string;
}

async function streamOneTurn(
  msgs: AgentHistoryItem[],
  deps: AgentDeps,
  state: { usage?: UsageLike; finalText: string },
): Promise<{
  stepText: string;
  toolCalls: ToolCall[];
  thinking: Array<{ thinking: string; signature: string }>;
}> {
  let stepText = '';
  let toolCalls: ToolCall[] = [];
  let thinking: Array<{ thinking: string; signature: string }> = [];
  // Faz 7 A4: tur içi kümülatif (max) → tur sonunda toplama (sum) eklenir.
  let turnUsage: TokenUsage | undefined;
  const onChunk = (c: StreamChunk) => {
    if (c.usage) {
      turnUsage = mergeUsage(turnUsage, c.usage);
    }
    if (c.text) {
      stepText += c.text;
      state.finalText += c.text;
      deps.onEvent({ k: 'text', delta: c.text });
    }
    // Faz 4: reasoning dim blokta akar (kalıcı mesaja useAgent/useStream yazar).
    if (c.reasoning) {
      deps.onEvent({ k: 'reasoning', delta: c.reasoning });
    }
    if (c.thinking && c.thinking.length > 0) {
      thinking = [...thinking, ...c.thinking];
    }
    if (c.toolCalls && c.toolCalls.length > 0) {
      toolCalls = [...toolCalls, ...c.toolCalls];
    }
  };
  // G6: 429/5xx + ağ hatalarında retry (400/401/abort retry etmez).
  const rawTools = deps.extraTools?.length ? [...CORE_TOOLS, ...deps.extraTools] : CORE_TOOLS;
  const tools = filterToolsForMode(rawTools, deps.agentMode ?? 'build');
  const runStream = () => {
    if (deps.streamImpl) {
      return deps.streamImpl({
        messages: toProviderMessages(msgs),
        tools,
        onChunk,
        signal: deps.signal,
      });
    }
    return getProvider(deps.provider).stream({
      apiKey: deps.apiKey,
      model: deps.model,
      systemPrompt: deps.systemPrompt,
      messages: toProviderMessages(msgs),
      tools,
      onChunk,
      signal: deps.signal,
      params: deps.params,
      registry: deps.registry,
      // Faz 11: prompt cache.
      ...(deps.cachePrompts !== false
        ? { cachePrompts: true, promptCacheKey: deps.promptCacheKey }
        : {}),
    });
  };
  await withRetry(() => runStream(), { retries: 2 });
  // Faz 7 A4: turun usage'ı toplama eklenir (her tur ayrı bir istektir).
  state.usage = sumUsage(state.usage, turnUsage);
  return { stepText, toolCalls, thinking };
}

function clipOutput(out: string): string {
  return out.length > 4000 ? `${out.slice(0, 4000)}\n…[kesildi]` : out;
}

type AuditDecision = 'allowed-auto' | 'allowed-approval' | 'denied' | 'approved' | 'rejected';

function audit(
  deps: AgentDeps,
  call: ToolCall,
  decision: AuditDecision,
  result: string,
): void {
  const sessionId = deps.auditSessionId;
  if (!sessionId) return;
  void appendAudit({
    sessionId,
    tool: String(call.name),
    argsPreview: JSON.stringify(call.args ?? {}).slice(0, 200),
    decision,
    result: result.slice(0, 200),
  }).catch(() => {});
}

/**
 * Faz 12 B.8 — kalıcı agent durumu.
 *
 * Uygulama yeniden başlatıldığında bekleyen onaylı iş kayboluyordu
 * ("yeniden başlatılamadı"). Durum JSON olarak `pending_approvals.run_state`
 * kolonuna yazılır ve boot'ta geri yüklenir → tur kaldığı yerden sürer.
 */
export interface AgentRunState {
  /** Konuşma geçmişi (mesajlar + araç sonuçları). */
  msgs: AgentHistoryItem[];
  /** Tamamlanmış tur sayısı (maxSteps sınırı korunur). */
  steps: number;
  /** O ana kadar üretilen metin. */
  finalText: string;
  /** Biriken kullanım (token). */
  usage: UsageLike | null;
  /** Onay bekleyen araç çağrıları. */
  pending: Array<{ call: ToolCall; patchId?: string }>;
}

export function createAgentRun(
  history: AgentHistoryItem[],
  deps: AgentDeps,
  resume?: Partial<AgentRunState>,
): AgentRun {
  const mode: ApprovalMode = deps.approvalMode ?? 'manual';
  const maxSteps = deps.maxSteps ?? 8;
  // Resume: kayıtlı durum varsa geçmiş ondan gelir (yoksa verilen history).
  const msgs: AgentHistoryItem[] = resume?.msgs ? [...resume.msgs] : [...history];
  let steps = resume?.steps ?? 0;
  let finalText = resume?.finalText ?? '';
  let usage: UsageLike | undefined = resume?.usage ?? undefined;
  let pending: PendingEntry[] = (resume?.pending ?? []).map((p) => ({
    call: p.call,
    ...(p.patchId ? { patchId: p.patchId } : {}),
  }));
  let aborted = false;
  const state = {
    get usage() { return usage; },
    set usage(u) { usage = u; },
    get finalText() { return finalText; },
    set finalText(t) { finalText = t; },
  };

  async function runLoop(): Promise<AgentStepResult> {
    for (; steps < maxSteps; ) {
      if (aborted || deps.signal?.aborted) break;
      const turn = await streamOneTurn(msgs, deps, state);
      steps += 1;
      const { stepText, toolCalls, thinking } = turn;
      if (thinking.length > 0) {
        deps.onEvent({ k: 'thinking', blocks: thinking });
      }
      if (toolCalls.length === 0) break;
      msgs.push({
        role: 'assistant',
        content: stepText,
        toolCalls: [...toolCalls],
        ...(thinking.length > 0 ? { thinking: [...thinking] } : {}),
      });
      const nextPending: PendingEntry[] = [];
      const effectiveDisallow = [
        ...(deps.disallowTools ?? []),
        ...getDisallowedToolsForMode(deps.agentMode ?? 'build'),
      ];
      for (const call of toolCalls) {
        if (aborted || deps.signal?.aborted) break;
        deps.onEvent({ k: 'tool_call', call });
        const decision = decideTool(call.name, call.args, mode, deps.extraAllow ?? {});
        if (effectiveDisallow.includes(String(call.name))) {
          const out = `hata: ${deps.agentMode ?? 'bu'} mod bu aracı kullanamaz: ${String(call.name)}`;
          deps.onEvent({ k: 'tool_result', id: call.id, ok: false, output: out });
          msgs.push({
            role: 'tool', toolCallId: call.id, toolName: call.name, content: out, isError: true,
          });
          continue;
        }
        if (!decision.allowed) {
          const out = `hata: ${decision.reason ?? 'yasaklı'}`;
          deps.onEvent({ k: 'tool_result', id: call.id, ok: false, output: out });
          msgs.push({
            role: 'tool', toolCallId: call.id, toolName: call.name, content: out, isError: true,
          });
          audit(deps, call, 'denied', out);
          continue;
        }
        const needsApproval = decision.allowed && !decision.autoApproved;
        if (needsApproval) {
          // Patch ise önizleme üret (salt-okuma) ama msgs'e yazma — UI extras'ta gösterilir.
          if (call.name === 'propose_patch' || call.name === 'edit_file') {
            try {
              // Gerçek akışta preview PendingPatch oluşturur; mock'ta string döner.
              const before = new Set(listPending().map((p) => p.id));
              const preview = await (deps.runToolImpl
                ? deps.runToolImpl(call)
                : defaultRunTool(deps.workspaceRoot, mode, call, msgs, { extraAllow: deps.extraAllow }));
              const after = listPending();
              const created = after.find((p) => !before.has(p.id));
              deps.onEvent({ k: 'tool_preview', id: call.id, output: clipOutput(preview) });
              nextPending.push({ call, patchId: created?.id });
              audit(deps, call, 'allowed-approval', preview);
            } catch (e) {
              const out = e instanceof Error ? e.message : String(e);
              deps.onEvent({ k: 'tool_result', id: call.id, ok: false, output: out });
              nextPending.push({ call });
              audit(deps, call, 'allowed-approval', out);
            }
          } else {
            nextPending.push({ call });
            audit(deps, call, 'allowed-approval', JSON.stringify(call.args ?? {}));
          }
          continue;
        }
        try {
          // Faz 9 P9.0 (B2): onaysız yazma yolunda (`auto-edit`) `propose_patch` /
          // `edit_file` yalnızca *pending patch* üretir; asıl yazma `applyPendingPatch`
          // ile olur ve o yol **sadece onay akışında** çalışırdı → dosya hiç
          // değişmiyordu, agent "yazdım" diyordu. Üretilen patch burada uygulanır.
          const beforePatches = new Set(listPending().map((p) => p.id));
          const out = await executeTool(deps, mode, call, msgs);
          let result = out;
          if (call.name === 'propose_patch' || call.name === 'edit_file') {
            const created = listPending().find((p) => !beforePatches.has(p.id));
            if (created) {
              const applied = await applyPendingPatch(deps.workspaceRoot, created.id);
              result = `${out}\n${applied}`;
            }
          }
          const clipped = clipOutput(result);
          deps.onEvent({ k: 'tool_result', id: call.id, ok: true, output: clipped });
          msgs.push({
            role: 'tool', toolCallId: call.id, toolName: call.name, content: clipped,
          });
          audit(deps, call, 'allowed-auto', clipped);
        } catch (e) {
          const out = e instanceof Error ? e.message : String(e);
          deps.onEvent({ k: 'tool_result', id: call.id, ok: false, output: out });
          msgs.push({
            role: 'tool', toolCallId: call.id, toolName: call.name, content: out, isError: true,
          });
          audit(deps, call, 'allowed-auto', out);
        }
      }
      if (nextPending.length > 0) {
        pending = nextPending;
        return { kind: 'needs-approval', pending: pending.map((p) => p.call) };
      }
    }
    deps.onEvent({ k: 'done', usage });
    return { kind: 'done', text: finalText, steps, usage };
  }

  return {
    async step(): Promise<AgentStepResult> {
      if (pending.length > 0) {
        return { kind: 'needs-approval', pending: pending.map((p) => p.call) };
      }
      return runLoop();
    },
    async resolve(decisions: Array<{ id: string; approved: boolean }>): Promise<AgentStepResult> {
      const byId = new Map(decisions.map((d) => [d.id, d.approved]));
      for (const entry of pending) {
        const approved = byId.get(entry.call.id);
        if (approved === undefined) continue;
        if (approved) {
          try {
            // Patch + preview varsa apply et, yoksa (mock/exec) tool'u çalıştır.
            if ((entry.call.name === 'propose_patch' || entry.call.name === 'edit_file') && entry.patchId) {
              const msg = await applyPendingPatch(deps.workspaceRoot, entry.patchId);
              deps.onEvent({ k: 'tool_result', id: entry.call.id, ok: true, output: msg });
              msgs.push({
                role: 'tool', toolCallId: entry.call.id, toolName: entry.call.name,
                content: msg,
              });
              audit(deps, entry.call, 'approved', msg);
            } else if (entry.call.name === 'propose_patch' || entry.call.name === 'edit_file') {
              // O7: patchId YOK — preview üretilememişti (catch) ya da restart
              // sonrası patch belleği boştu. Tool'u sessizce yeniden koşturup
              // "pre-view + /apply" önizleme metnini başarı gibi vermek
              // YALANCI başarıydı (dosya yazılmamıştı). Bu turda üretilen yeni
              // bekleyen yama hemen uygulanır (onay zaten alındı).
              const before = new Set(listPending().map((p) => p.id));
              const out0 = await (deps.runToolImpl
                ? deps.runToolImpl(entry.call)
                : defaultRunTool(deps.workspaceRoot, mode, entry.call, msgs, {
                    approved: true,
                    extraAllow: deps.extraAllow,
                  }));
              const created = listPending().find((p) => !before.has(p.id));
              let result = out0;
              if (created) {
                result = `${out0}\n${await applyPendingPatch(deps.workspaceRoot, created.id)}`;
              }
              const clipped0 = clipOutput(result);
              deps.onEvent({ k: 'tool_result', id: entry.call.id, ok: true, output: clipped0 });
              msgs.push({
                role: 'tool', toolCallId: entry.call.id, toolName: entry.call.name,
                content: clipped0,
              });
              audit(deps, entry.call, 'approved', clipped0);
            } else {
              // Y2 (Faz 3): exec yalnızca buradan (resolve) çalışır — `approved: true`
              // başka hiçbir çağrı noktasına geçmez.
              const out = await (deps.runToolImpl
                ? deps.runToolImpl(entry.call)
                : defaultRunTool(deps.workspaceRoot, mode, entry.call, msgs, {
                    approved: true,
                    extraAllow: deps.extraAllow,
                  }));
              const clipped = clipOutput(out);
              deps.onEvent({ k: 'tool_result', id: entry.call.id, ok: true, output: clipped });
              msgs.push({
                role: 'tool', toolCallId: entry.call.id, toolName: entry.call.name,
                content: clipped,
              });
              audit(deps, entry.call, 'approved', clipped);
            }
          } catch (e) {
            const out = e instanceof Error ? e.message : String(e);
            deps.onEvent({ k: 'tool_result', id: entry.call.id, ok: false, output: out });
            msgs.push({
              role: 'tool', toolCallId: entry.call.id, toolName: entry.call.name,
              content: out, isError: true,
            });
            audit(deps, entry.call, 'approved', out);
          }
        } else {
          // K2: reddet + devam et — döngü kırılmaz.
          const out = 'kullanıcı reddetti — alternatif bir yol öner';
          deps.onEvent({ k: 'tool_result', id: entry.call.id, ok: false, output: out });
          msgs.push({
            role: 'tool', toolCallId: entry.call.id, toolName: entry.call.name,
            content: out, isError: true,
          });
          audit(deps, entry.call, 'rejected', out);
        }
      }
      // O7: karar gelmeyen bekleyenler sessizce DÜŞÜRÜLÜR ama sağlıklı
      // protokol için tool_result yazılmalı — aksi halde assistant'ın
      // tool_use'u sonuca bağlanmadan API'ye gider (Anthropic 400 verir,
      // tur kalıcı olarak kilitlenirdi).
      for (const entry of pending) {
        if (byId.has(entry.call.id)) continue;
        const out = 'onay cevabı gelmedi — çağrı iptal edildi · gerekirse yeniden iste';
        deps.onEvent({ k: 'tool_result', id: entry.call.id, ok: false, output: out });
        msgs.push({
          role: 'tool', toolCallId: entry.call.id, toolName: entry.call.name,
          content: out, isError: true,
        });
        audit(deps, entry.call, 'rejected', out);
      }
      pending = [];
      return runLoop();
    },
    serialize(): string {
      const state: AgentRunState = {
        msgs,
        steps,
        finalText,
        usage: usage ?? null,
        pending: pending.map((p) => ({
          call: p.call,
          ...(p.patchId ? { patchId: p.patchId } : {}),
        })),
      };
      return JSON.stringify(state);
    },
    abort(): void {
      aborted = true;
    },
  };
}

export { applyPendingPatch, undoLastPatch };
