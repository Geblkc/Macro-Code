import { describe, expect, it, vi } from 'vitest';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';

function sseResponse(lines: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l + '\n'));
      c.close();
    },
  });
  return new Response(body, { status: 200 });
}

describe('Yerel (Native) Tool Calling Biçimlendirme', () => {
  it('Anthropic: tool_use ve tool_result blokları yerel formatta gönderilir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['event: message_stop', 'data: {"type":"message_stop"}']));

    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5-5',
      messages: [
        { role: 'user', content: 'dosyayı oku' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'read_file', args: { path: 'src/main.tsx' } }],
        },
        {
          role: 'tool',
          toolCallId: 'call_1',
          toolName: 'read_file',
          content: 'export default App;',
        },
      ],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    expect(body.messages).toHaveLength(3);
    expect(body.messages[0]).toEqual({ role: 'user', content: 'dosyayı oku' });
    expect(body.messages[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'read_file',
          input: { path: 'src/main.tsx' },
        },
      ],
    });
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: 'export default App;',
        },
      ],
    });
  });

  it('Anthropic: ardışık birden fazla tool_result tek bir user mesajında birleştirilir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['event: message_stop', 'data: {"type":"message_stop"}']));

    await anthropicProvider.stream({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5-5',
      messages: [
        { role: 'user', content: 'iki dosya oku' },
        {
          role: 'assistant',
          content: 'okuyorum',
          toolCalls: [
            { id: 'c1', name: 'read_file', args: { path: 'a.txt' } },
            { id: 'c2', name: 'read_file', args: { path: 'b.txt' } },
          ],
        },
        { role: 'tool', toolCallId: 'c1', toolName: 'read_file', content: 'içerik a' },
        { role: 'tool', toolCallId: 'c2', toolName: 'read_file', content: 'içerik b' },
      ],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      messages: Array<{ role: string; content: unknown }>;
    };

    // user -> assistant (2 tool_use) -> tek user (2 tool_result)
    expect(body.messages).toHaveLength(3);
    expect(body.messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'içerik a' },
        { type: 'tool_result', tool_use_id: 'c2', content: 'içerik b' },
      ],
    });
  });

  it('Gemini: functionCall ve functionResponse blokları yerel formatta gönderilir', async () => {
    const fetchImpl = vi.fn(async () => sseResponse(['data: {}']));

    await geminiProvider.stream({
      apiKey: 'gemini-key',
      model: 'gemini-3.8-flash',
      messages: [
        { role: 'user', content: 'dizini listele' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'g_1', name: 'list_dir', args: { path: '' } }],
        },
        {
          role: 'tool',
          toolCallId: 'g_1',
          toolName: 'list_dir',
          content: 'dir src\nfile package.json',
        },
      ],
      onChunk: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [, opts] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(opts.body as string) as {
      contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };

    expect(body.contents).toHaveLength(3);
    expect(body.contents[0]).toEqual({ role: 'user', parts: [{ text: 'dizini listele' }] });
    expect(body.contents[1]).toEqual({
      role: 'model',
      parts: [
        {
          functionCall: {
            name: 'list_dir',
            args: { path: '' },
          },
        },
      ],
    });
    expect(body.contents[2]).toEqual({
      role: 'function',
      parts: [
        {
          functionResponse: {
            name: 'list_dir',
            response: { output: 'dir src\nfile package.json' },
          },
        },
      ],
    });
  });
});
