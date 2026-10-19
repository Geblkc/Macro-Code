import { describe, expect, it } from 'vitest';
import {
  CORE_TOOLS,
  accumulateAnthropicToolUse,
  accumulateOpenAIToolCalls,
  geminiFunctionCallToToolCall,
  safeParseArgs,
  toAnthropicTools,
  toGeminiTools,
  toOpenAITools,
} from './toolspec';
import { supportsTools } from './providers';

describe('Faz A — kanonik tools', () => {
  it('11 çekirdek tool tanımlı', () => {
    expect(CORE_TOOLS.map((t) => t.name)).toEqual([
      'read_file',
      'list_dir',
      'grep',
      'glob',
      'propose_patch',
      'edit_file',
      'write_file',
      'exec',
      'todo',
      'subagent',
      'plan',
    ]);
  });

  it('Faz 8 L1: subagent aracı salt-okunur tanımlı', () => {
    const byName = Object.fromEntries(CORE_TOOLS.map((t) => [t.name, t]));
    expect(byName.subagent.parameters.required).toEqual(['task']);
    expect(byName.subagent.parameters.properties).toHaveProperty('task');
  });

  it('Faz 3: yeni tool JSON şemaları', () => {
    const byName = Object.fromEntries(CORE_TOOLS.map((t) => [t.name, t]));
    expect(byName.grep.parameters.properties).toHaveProperty('regex');
    expect(byName.read_file.parameters.properties).toHaveProperty('offset');
    expect(byName.glob.parameters.required).toEqual(['pattern']);
    expect(byName.write_file.parameters.required).toEqual(['path', 'content']);
    expect(byName.todo.parameters.required).toEqual(['action']);
    const openai = toOpenAITools([byName.glob, byName.write_file, byName.todo]);
    expect(openai.map((t) => t.function.name)).toEqual(['glob', 'write_file', 'todo']);
    const anthropic = toAnthropicTools([byName.todo]);
    expect(anthropic[0].input_schema).toBeDefined();
  });

  it('OpenAI dönüşümü type=function üretir', () => {
    const out = toOpenAITools(CORE_TOOLS.slice(0, 1));
    expect(out[0].type).toBe('function');
    expect(out[0].function.name).toBe('read_file');
  });

  it('Anthropic dönüşümü input_schema taşır', () => {
    const out = toAnthropicTools(CORE_TOOLS.slice(0, 1));
    expect(out[0].name).toBe('read_file');
    expect(out[0].input_schema).toBeDefined();
  });

  it('Gemini dönüşümü functionDeclarations taşır', () => {
    const out = toGeminiTools(CORE_TOOLS.slice(0, 1));
    expect(out.functionDeclarations[0].name).toBe('read_file');
  });

  it('OpenAI delta birikimi args JSON birleştirir', () => {
    const calls = accumulateOpenAIToolCalls([
      { id: 'c1', function: { name: 'read_', arguments: '{"pa' } },
      { function: { name: 'file', arguments: 'th":"a.ts"}' } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('read_file');
    expect(calls[0].args).toEqual({ path: 'a.ts' });
  });

  it('Anthropic tool_use birikimi çalışır', () => {
    const calls = accumulateAnthropicToolUse(
      [{ id: 't1', name: 'list_dir' }],
      ['{"path":"src"}'],
    );
    expect(calls[0]).toMatchObject({ id: 't1', name: 'list_dir', args: { path: 'src' } });
  });

  it('Gemini functionCall dönüşür', () => {
    const c = geminiFunctionCallToToolCall({ name: 'exec', args: { cmd: 'npm' } }, 'g1');
    expect(c).toMatchObject({ id: 'g1', name: 'exec' });
  });

  it('bozuk args güvenli parse edilir', () => {
    expect(safeParseArgs('{{{')).toHaveProperty('_raw');
    expect(safeParseArgs('')).toEqual({});
  });

  it('supportsTools: ollama false, diğerleri true', () => {
    expect(supportsTools('ollama')).toBe(false);
    expect(supportsTools('openai')).toBe(true);
    expect(supportsTools('anthropic')).toBe(true);
    expect(supportsTools('gemini')).toBe(true);
  });
});
