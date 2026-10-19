import { describe, expect, it } from 'vitest';
import {
  applyTodoAction,
  deriveTodoState,
  formatTodos,
  type TodoState,
} from './todo';

const EMPTY: TodoState = { items: [] };

describe('Faz 3 — todo', () => {
  it('add/complete/list geçişleri', () => {
    const a = applyTodoAction(EMPTY, { action: 'add', text: 'testleri yaz' });
    expect(a.state.items).toHaveLength(1);
    expect(a.state.items[0]).toMatchObject({ text: 'testleri yaz', done: false });
    const id = a.state.items[0].id;
    expect(a.output).toContain(id);
    const c = applyTodoAction(a.state, { action: 'complete', id });
    expect(c.state.items[0].done).toBe(true);
    expect(c.output).toContain('[x]');
    const l = applyTodoAction(c.state, { action: 'list' });
    expect(l.state).toEqual(c.state);
    expect(l.output).toContain('[x]');
  });

  it('geçersiz girişler hata verir', () => {
    expect(() => applyTodoAction(EMPTY, { action: 'add', text: '' })).toThrow(/text gerekli/);
    expect(() => applyTodoAction(EMPTY, { action: 'complete', id: 'yok' })).toThrow(/bulunamadı/);
    expect(() => applyTodoAction(EMPTY, { action: 'sil' })).toThrow(/bilinmeyen todo action/);
    expect(formatTodos(EMPTY)).toBe('(todo yok)');
  });

  it('deriveTodoState history’den türetir', () => {
    const history = [
      { toolCalls: [{ name: 'read_file', args: {} }] },
      { toolCalls: [{ name: 'todo', args: { action: 'add', id: 't1', text: 'bir' } }] },
      { toolCalls: [{ name: 'todo', args: { action: 'add', id: 't2', text: 'iki' } }] },
      { toolCalls: [{ name: 'todo', args: { action: 'complete', id: 't1' } }] },
      // Bozuk çağrı türetmeyi kırmaz.
      { toolCalls: [{ name: 'todo', args: { action: 'complete', id: 'yok' } }] },
    ];
    const s = deriveTodoState(history);
    expect(s.items).toHaveLength(2);
    expect(s.items.find((t) => t.id === 't1')?.done).toBe(true);
    expect(s.items.find((t) => t.id === 't2')?.done).toBe(false);
  });

  it('son 50 mesajla sınırlı', () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      toolCalls: [{ name: 'todo', args: { action: 'add', id: `eski-${i}`, text: 'x' } }],
    }));
    const s = deriveTodoState(history);
    expect(s.items).toHaveLength(50);
    expect(s.items[0].id).toBe('eski-10');
  });
});
