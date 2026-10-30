import { describe, expect, it } from 'vitest';
import {
  APPROVAL_BODY_PREVIEW_CHARS,
  APPROVAL_LARGE_PAYLOAD_CHARS,
  formatApprovalDetail,
} from './approvalDetail';
import type { ToolCall } from './types';

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: 't1',
  name,
  args,
});

describe('L4 — onay kartı tam argüman görünürlüğü', () => {
  it('exec tam komut satırını verir, gövdeyi kırpmaz', () => {
    const longArg = 'x'.repeat(2000);
    const d = formatApprovalDetail(call('exec', { cmd: 'git', args: ['commit', '-m', longArg] }));
    expect(d.summary).toBe(`git commit -m ${longArg}`);
    expect(d.summary.length).toBeGreaterThan(240);
    expect(d.body).toBeNull();
    expect(d.collapsible).toBe(false);
    expect(d.bodyChars).toBe(d.summary.length);
  });

  it('write_file: yol özeti + tam içerik gövdesi (kırpma yok)', () => {
    const content = 'a'.repeat(APPROVAL_BODY_PREVIEW_CHARS + 500);
    const d = formatApprovalDetail(call('write_file', { path: 'src/uzun.ts', content }));
    expect(d.summary).toBe('src/uzun.ts');
    expect(d.body).toBe(content);
    expect(d.bodyChars).toBe(content.length);
    expect(d.collapsible).toBe(true);
  });

  it('propose_patch: tam içerik korunur', () => {
    const content = 'satır 1\nsatır 2\n';
    const d = formatApprovalDetail(call('propose_patch', { path: 'a.txt', content }));
    expect(d.summary).toBe('a.txt');
    expect(d.body).toBe(content);
    expect(d.collapsible).toBe(true);
  });

  it('edit_file: search + replace tam JSON olarak gösterilir', () => {
    const d = formatApprovalDetail(
      call('edit_file', { path: 'a.ts', search: 'eski', replace: 'yeni' }),
    );
    expect(d.summary).toBe('a.ts');
    expect(d.body).toContain('"search": "eski"');
    expect(d.body).toContain('"replace": "yeni"');
  });

  it('MCP: tam JSON — 240/4k üstü argüman kesilmez ve işaretlenir', () => {
    const payload = 'z'.repeat(APPROVAL_LARGE_PAYLOAD_CHARS + 100);
    const d = formatApprovalDetail(call('mcp:server:tool', { data: payload }));
    expect(d.body).toContain(payload);
    expect(d.bodyChars).toBeGreaterThan(APPROVAL_LARGE_PAYLOAD_CHARS);
    expect(d.collapsible).toBe(true);
  });

  it('diğer araçlar: JSON tam ve okunur biçimde', () => {
    const d = formatApprovalDetail(call('custom_tool', { b: 2, a: 1 }));
    expect(d.body).toBe('{\n  "b": 2,\n  "a": 1\n}');
    expect(d.summary).toBe('');
  });

  it('boş/eksik argümanlarda güvenli varsayılanlar', () => {
    const d = formatApprovalDetail({ id: 't', name: 'write_file', args: {} });
    expect(d.summary).toBe('');
    expect(d.body).toBe('');
    expect(d.bodyChars).toBe(0);
  });
});
