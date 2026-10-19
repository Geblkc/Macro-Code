import { describe, expect, it } from 'vitest';
import { decideTool } from '../policy';
import {
  isMcpToolName,
  makeMcpServerId,
  mcpCallFromToolCall,
  mcpToolName,
  parseMcpName,
  toToolDefinitions,
} from './registry';

describe('Faz 5 — MCP registry', () => {
  it('namespace adaptasyonu (çakışma imkânsız)', () => {
    expect(mcpToolName('s', 'oku')).toBe('mcp:s:oku');
    expect(isMcpToolName('mcp:s:oku')).toBe(true);
    expect(isMcpToolName('read_file')).toBe(false);
    expect(parseMcpName('mcp:sunucu:araç')).toEqual({ server: 'sunucu', tool: 'araç' });
    expect(parseMcpName('mcp:eksik')).toBeNull();
    const defs = toToolDefinitions('s', [
      { name: 'oku', description: 'dosya okur', inputSchema: { type: 'object' } },
    ]);
    expect(defs[0].name).toBe('mcp:s:oku');
    expect(defs[0].description).toContain('[mcp:s]');
    expect(mcpCallFromToolCall({ id: 'c', name: 'mcp:s:oku', args: {} })).toEqual({
      server: 's',
      tool: 'oku',
    });
  });

  it('policy: mcp:* her zaman onaylı (autoApproved:false)', () => {
    const d = decideTool('mcp:sunucu:oku', { a: 1 }, 'auto-edit');
    expect(d.allowed).toBe(true);
    expect(d.autoApproved).toBe(false);
    expect(decideTool('mcp:bozuk', {}, 'manual').allowed).toBe(false);
  });

  it('makeMcpServerId TR uyumlu slug üretir', () => {
    expect(makeMcpServerId('Dosya Sunucum')).toBe('mcp_dosya-sunucum');
    expect(makeMcpServerId('  ')).toBe('mcp_sunucu');
    expect(makeMcpServerId('X'.repeat(100)).length).toBeLessThanOrEqual(52);
  });
});
