/**
 * Agent çalışma modları: build, plan, ask.
 * Her modun araç erişimi ve sisteme eklenen talimatları farklıdır.
 */
import type { AgentMode } from '../../types';
import type { ToolDefinition } from './types';

/** Salt-okunur araç isimleri (plan modunda açık, ask modunda da kullanılabilir). */
export const READ_ONLY_TOOL_NAMES = ['read_file', 'list_dir', 'grep', 'glob', 'todo', 'plan'] as const;

/** Değişiklik yapan (yazma ve çalıştırma) araçlar. */
export const WRITE_AND_EXEC_TOOL_NAMES = ['edit_file', 'write_file', 'propose_patch', 'exec', 'subagent'] as const;

/**
 * Moda göre modele sunulacak araç listesini filtreler.
 * - build: tüm araçlar açık (CORE_TOOLS + extraTools).
 * - plan: yalnızca salt-okunur araştırma ve planlama araçları (read, list, grep, glob, todo, plan).
 * - ask: salt-okunur inceleme araçları (read, list, grep, glob) - yazma ve komut çalıştırma kesinlikle yok.
 */
export function filterToolsForMode(tools: ToolDefinition[], mode: AgentMode = 'build'): ToolDefinition[] {
  if (mode === 'build') {
    return tools;
  }
  if (mode === 'plan') {
    return tools.filter((t) => READ_ONLY_TOOL_NAMES.includes(t.name as (typeof READ_ONLY_TOOL_NAMES)[number]));
  }
  if (mode === 'ask') {
    // Soru-cevap modunda model isterse kod inceleyebilsin ama plan/todo/yazma araçları olmasın
    const askAllowed = ['read_file', 'list_dir', 'grep', 'glob'];
    return tools.filter((t) => askAllowed.includes(t.name));
  }
  return tools;
}

/**
 * M2 — `mcp:` araçları dinamik olduğu için ada göre listelenemez; yasak
 * listesinde `mcp:*` önek deseniyle temsil edilir.
 */
export const MCP_TOOL_WILDCARD = 'mcp:*';

/**
 * M2 — bir araç adı yasak listesindeki bir desene uyuyor mu?
 *
 * Eski kontrol `disallowed.includes(name)` idi: `mcp:*` gibi bir önek
 * deseni hiçbir zaman eşleşmediğinden model `mcp:sunucu:araç` çağırdığında
 * yasak deliniyordu (plan/ask modunda onay kartına düşüp çalışabiliyordu).
 * Desteklenen sözdizimi: birebir ad veya `önek:*` (sondaki `*` joker).
 */
export function isToolDisallowed(name: string, disallowed: readonly string[]): boolean {
  const toolName = String(name);
  return disallowed.some((pattern) => {
    if (pattern === toolName) return true;
    if (pattern.endsWith(':*')) {
      return toolName.startsWith(pattern.slice(0, -1));
    }
    return false;
  });
}

/**
 * Moda göre yasaklı (disallow) araç isimlerini döndürür.
 *
 * M2: plan/ask modları salt-okunur kabul edilir — MCP araçları yan etki
 * yapabildiği için (DB yazma, dış servis çağrısı) bu modlarda kapalıdır.
 */
export function getDisallowedToolsForMode(mode: AgentMode = 'build'): string[] {
  if (mode === 'plan') {
    return [...WRITE_AND_EXEC_TOOL_NAMES, MCP_TOOL_WILDCARD];
  }
  if (mode === 'ask') {
    return [...WRITE_AND_EXEC_TOOL_NAMES, 'todo', 'plan', 'subagent', MCP_TOOL_WILDCARD];
  }
  return [];
}

/**
 * Moda göre system prompt'a eklenecek özel rehber/yönerge bloğu.
 */
export function getModePrompt(mode: AgentMode = 'build'): string {
  switch (mode) {
    case 'plan':
      return [
        '[AGENT MODE: PLAN]',
        'You are strictly in PLANNING and ARCHITECTURAL ANALYSIS mode.',
        '- Do NOT write, modify, or execute code or shell commands.',
        '- Your role is to inspect the codebase, identify requirements, evaluate potential risks, and design a concrete, step-by-step implementation plan.',
        '- Structure your plan clearly using numbered steps or the plan/todo tool.',
        '- When the plan is ready, ask the user if they would like to switch to BUILD mode to execute it.',
      ].join('\n');

    case 'ask':
      return [
        '[AGENT MODE: ASK]',
        'You are in CONSULTATION and QUESTION-ANSWERING mode.',
        '- You are here to answer questions, explain concepts, analyze architecture, and guide the user.',
        '- Do NOT modify any files or execute commands.',
        '- Provide clear, concise, and educational explanations with helpful examples.',
      ].join('\n');

    case 'build':
    default:
      return [
        '[AGENT MODE: BUILD]',
        'You are in BUILD mode with full development capabilities.',
        '- You can read, write, edit files, and execute allowed workspace commands to implement solutions directly.',
        '- Always verify changes and maintain code quality.',
      ].join('\n');
  }
}
