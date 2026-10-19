import { describe, expect, it } from 'vitest';
import { deriveTodoState, planStepIds } from './todo';

describe('Faz 8 L2 — plan adımları görev takibine bağlanır', () => {
  it('plan çağrısı adımları görev olarak üretir', () => {
    const state = deriveTodoState([
      {
        toolCalls: [
          { name: 'plan', args: { steps: ['dosyayı oku', 'testleri çalıştır'] } },
        ],
      },
    ]);
    expect(state.items).toHaveLength(2);
    expect(state.items[0]).toMatchObject({ id: 'plan-1', text: 'dosyayı oku', done: false });
    expect(state.items[1]).toMatchObject({ id: 'plan-2', text: 'testleri çalıştır' });
  });

  it('plan + todo karışımı: todo çağrıları da işlenir', () => {
    const state = deriveTodoState([
      { toolCalls: [{ name: 'plan', args: { steps: ['a', 'b'] } }] },
      { toolCalls: [{ name: 'todo', args: { action: 'complete', id: 'plan-1' } }] },
    ]);
    expect(state.items.find((t) => t.id === 'plan-1')?.done).toBe(true);
    expect(state.items.find((t) => t.id === 'plan-2')?.done).toBe(false);
  });

  it('birden fazla plan çağrısında id\'ler çakışmaz', () => {
    const state = deriveTodoState([
      { toolCalls: [{ name: 'plan', args: { steps: ['a', 'b'] } }] },
      { toolCalls: [{ name: 'plan', args: { steps: ['c'] } }] },
    ]);
    expect(state.items.map((t) => t.id)).toEqual(['plan-1', 'plan-2', 'plan-3']);
  });

  it('boş adımlar atlanır', () => {
    const state = deriveTodoState([
      { toolCalls: [{ name: 'plan', args: { steps: ['  ', 'geçerli'] } }] },
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].text).toBe('geçerli');
  });

  it('planStepIds verilen başlangıçtan sayar', () => {
    const call = { args: { steps: ['x', 'y'] } };
    expect(planStepIds(call, 0)).toEqual(['plan-1', 'plan-2']);
    expect(planStepIds(call, 5)).toEqual(['plan-6', 'plan-7']);
  });
});
