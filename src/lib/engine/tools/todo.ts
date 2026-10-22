/**
 * Faz 3 — Görev takibi (saf state yönetimi).
 * State kalıcı katmanda durmaz; tool geçmişinden türetilir
 * (`deriveTodoState`), son 50 mesaj taranır.
 */
import { strArg } from '../toolspec';
import { t } from '../../i18n/core';

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface TodoState {
  items: TodoItem[];
}

export function formatTodos(state: TodoState): string {
  if (state.items.length === 0) return '(todo yok)';
  return state.items
    .map((t) => `${t.done ? '[x]' : '[ ]'} ${t.id} ${t.text}`)
    .join('\n');
}

export function applyTodoAction(
  state: TodoState,
  args: Record<string, unknown>,
): { state: TodoState; output: string } {
  const action = strArg(args, 'action', '');
  if (action === 'list') {
    return { state, output: formatTodos(state) };
  }
  if (action === 'add') {
    const text = strArg(args, 'text', '');
    if (!text) throw new Error(t('tool.todoAddText'));
    const id = strArg(args, 'id', '') || `todo-${state.items.length + 1}`;
    const items = state.items.some((t) => t.id === id)
      ? state.items.map((t) => (t.id === id ? { ...t, text } : t))
      : [...state.items, { id, text, done: false }];
    const next = { items };
    return { state: next, output: `/// todo eklendi: ${id}\n${formatTodos(next)}` };
  }
  if (action === 'complete') {
    const id = strArg(args, 'id', '');
    if (!id) throw new Error(t('tool.todoCompleteId'));
    if (!state.items.some((t) => t.id === id)) {
      throw new Error(`todo bulunamadı: ${id}`);
    }
    const next = {
      items: state.items.map((t) => (t.id === id ? { ...t, done: true } : t)),
    };
    return { state: next, output: `/// todo tamamlandı: ${id}\n${formatTodos(next)}` };
  }
  throw new Error(`bilinmeyen todo action: ${action} · add/complete/list kullan`);
}

interface HistoryLike {
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
}

/** `plan` çağrısının adımları → görev id'leri (geçmiş boyunca sıralı, deterministik). */
export function planStepIds(call: { args?: Record<string, unknown> }, startIndex: number): string[] {
  const steps = Array.isArray(call.args?.steps) ? call.args!.steps : [];
  return steps
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((_, i) => `plan-${startIndex + i + 1}`);
}

/**
 * Konuşma geçmişindeki todo çağrılarını sırayla uygulayarak durumu türetir.
 *
 * Faz 8 L2: `plan` çağrıları da görev üretir — plan adımları `todo` ile
 * işaretlenebilir hâle gelir (önceden plan yalnızca ekrana basılıyordu).
 */
export function deriveTodoState(history: HistoryLike[]): TodoState {
  let state: TodoState = { items: [] };
  const recent = history.slice(-50);
  let planCounter = 0;
  for (const m of recent) {
    for (const c of m.toolCalls ?? []) {
      const name = String(c.name);
      if (name === 'todo') {
        try {
          state = applyTodoAction(state, (c.args ?? {}) as Record<string, unknown>).state;
        } catch {
          // Bozuk çağrıyı atla, türetmeyi sürdür.
        }
        continue;
      }
      if (name === 'plan') {
        // Boş adımlar elenir → id ile eşleşme bozulmaz.
        const steps = (Array.isArray(c.args?.steps) ? c.args!.steps : []).filter(
          (st): st is string => typeof st === 'string' && st.trim().length > 0,
        );
        const ids = planStepIds(c, planCounter);
        planCounter += ids.length;
        steps.forEach((step, i) => {
          const text = step.trim();
          const id = ids[i];
          if (!text || !id) return;
          if (state.items.some((t) => t.id === id)) return;
          state = { items: [...state.items, { id, text, done: false }] };
        });
      }
    }
  }
  return state;
}
