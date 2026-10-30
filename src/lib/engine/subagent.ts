/**
 * Faz 5b — Salt-okunur alt-agent: aynı tool setinin okuma alt kümesiyle çalışır,
 * kendi context bütçesiyle özetlenir, koordinatöre tek özet döner.
 * Yazma araçları (exec/write_file/edit_file/propose_patch) yasaktır.
 */
import { compactHistory } from './compact';
import { budgetFor } from './tokens';
import { createAgentRun, type AgentDeps, type AgentHistoryItem } from './agent';

export const SUBAGENT_BLOCKED_TOOLS = [
  'exec',
  'write_file',
  'edit_file',
  'propose_patch',
  // Faz 8 L1: alt-agent alt-agent çağıramaz (özyineleme koruması).
  'subagent',
  // M2: MCP araçları salt-okunur alt-agent'ta kapalı — dinamik adlar
  // `mcp:*` joker deseniyle engellenir (yan etki yapabilirler).
  'mcp:*',
];

export interface SubagentResult {
  text: string;
  steps: number;
  compacted: boolean;
}

export interface SubagentDeps extends AgentDeps {
  summarize: (transcript: string) => Promise<string>;
}

/**
 * Alt-görev çalıştırır. Geçmiş bütçeyi aşarsa Faz 2 compaction ile küçültülür
 * (özetleyici enjeksiyonu). Yazma denemeleri hata sonucu alır, döngü sürer.
 */
export async function runSubagent(
  task: string,
  history: AgentHistoryItem[],
  deps: SubagentDeps,
): Promise<SubagentResult> {
  const budget = budgetFor(deps.model, deps.customModels ?? []);
  let effHistory = history;
  let compacted = false;
  try {
    const out = await compactHistory({ history, budget, summarize: deps.summarize });
    if (out !== history) {
      effHistory = out;
      compacted = true;
    }
  } catch {
    effHistory = history;
  }
  // Faz 8 L1/L8: alt-agent `createAgentRun` üzerinden çalışır (tek döngü
  // uygulaması kaldı — eski `runAgent` kopyası silindi).
  const run = createAgentRun([...effHistory, { role: 'user', content: task }], {
    ...deps,
    maxSteps: Math.min(deps.maxSteps ?? 8, 4),
    disallowTools: [...(deps.disallowTools ?? []), ...SUBAGENT_BLOCKED_TOOLS],
    // Alt-ajanın **metni** ana akışa karışmasın (iki kez akmasın); araç
    // olayları (tool_call/tool_result) geçer — kullanıcı ilerlemeyi görsün.
    onEvent: (e) => {
      if (e.k === 'text') return;
      deps.onEvent(e);
    },
  });
  const result = await run.step();
  if (result.kind === 'needs-approval') {
    // Salt-okunur alt-agent onay isteyemez; yine de güvenli davranış.
    return { text: '(alt ajan onay bekleyen bir araç istedi — atlandı)', steps: 0, compacted };
  }
  return { text: result.text, steps: result.steps, compacted };
}
