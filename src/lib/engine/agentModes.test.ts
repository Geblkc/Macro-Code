import { describe, it, expect } from 'vitest';
import { CORE_TOOLS } from './toolspec';
import {
  filterToolsForMode,
  getDisallowedToolsForMode,
  getModePrompt,
  isToolDisallowed,
  MCP_TOOL_WILDCARD,
} from './agentModes';

describe('agentModes', () => {
  it('build modu tüm araçlara izin verir', () => {
    const filtered = filterToolsForMode(CORE_TOOLS, 'build');
    expect(filtered).toHaveLength(CORE_TOOLS.length);
    expect(getDisallowedToolsForMode('build')).toEqual([]);
    expect(getModePrompt('build')).toContain('[AGENT MODE: BUILD]');
  });

  it('plan modu yalnızca salt-okunur ve planlama araçlarına izin verir', () => {
    const filtered = filterToolsForMode(CORE_TOOLS, 'plan');
    const names = filtered.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('list_dir');
    expect(names).toContain('grep');
    expect(names).toContain('glob');
    expect(names).toContain('plan');
    expect(names).toContain('todo');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('edit_file');
    expect(names).not.toContain('exec');
    expect(getDisallowedToolsForMode('plan')).toContain('write_file');
    expect(getDisallowedToolsForMode('plan')).toContain('exec');
    expect(getModePrompt('plan')).toContain('[AGENT MODE: PLAN]');
  });

  it('ask modu yalnızca inceleme araçlarına izin verir, plan/todo/yazma kapalıdır', () => {
    const filtered = filterToolsForMode(CORE_TOOLS, 'ask');
    const names = filtered.map((t) => t.name);
    expect(names).toContain('read_file');
    expect(names).toContain('grep');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('exec');
    expect(names).not.toContain('plan');
    expect(names).not.toContain('todo');
    expect(getDisallowedToolsForMode('ask')).toContain('exec');
    expect(getModePrompt('ask')).toContain('[AGENT MODE: ASK]');
  });

  it('M2: isToolDisallowed birebir ve `önek:*` joker eşleşmesi yapar', () => {
    expect(isToolDisallowed('exec', ['exec', 'write_file'])).toBe(true);
    expect(isToolDisallowed('exec2', ['exec'])).toBe(false);
    // `mcp:*` → tüm mcp:<sunucu>:<araç> adları.
    expect(isToolDisallowed('mcp:filesystem:read_file', [MCP_TOOL_WILDCARD])).toBe(true);
    expect(isToolDisallowed('mcp:', [MCP_TOOL_WILDCARD])).toBe(true);
    // Önek sınırı: `mcp:` ile başlamayan ad eşleşmez.
    expect(isToolDisallowed('mcpx:filesystem:read', [MCP_TOOL_WILDCARD])).toBe(false);
    expect(isToolDisallowed('read_file', [MCP_TOOL_WILDCARD])).toBe(false);
    expect(isToolDisallowed('anything', [])).toBe(false);
  });

  it('M2: plan/ask modları MCP araçlarını yasaklar, build yasaklamaz', () => {
    expect(getDisallowedToolsForMode('plan')).toContain(MCP_TOOL_WILDCARD);
    expect(getDisallowedToolsForMode('ask')).toContain(MCP_TOOL_WILDCARD);
    expect(getDisallowedToolsForMode('build')).not.toContain(MCP_TOOL_WILDCARD);
  });
});
