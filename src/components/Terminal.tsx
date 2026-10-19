import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MessageLine from './MessageLine';
import type { ExtraLine, Message, Session, TerminalLine } from '../types';
import type { PendingApproval } from '../lib/engine/approvals';
import { execApprovalWarning } from '../lib/engine/policy';
import { useSessionStore } from '../store/session';
import { useSettingsStore } from '../store/settings';
import { deriveTodoState } from '../lib/engine/tools/todo';

interface Props {
  session: Session | null;
  extras: ExtraLine[];
  clearedBefore: number | null;
  pending?: PendingApproval[];
  onApprove?: () => void;
  onReject?: () => void;
}

interface ViewLine {
  key: string;
  ts: number;
  type: TerminalLine['type'];
  content: string;
  images?: string[];
  isStreaming?: boolean;
  thinking?: boolean;
  meta?: string;
  reasoning?: string;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return `${n}`;
}

function formatUsage(m: Message): string | null {
  if (!m.tokens) return null;
  return `in:${formatCount(m.tokens.input)} · out:${formatCount(m.tokens.output)}`;
}

function toViewLine(m: Message, streaming: boolean, isLast: boolean): ViewLine {
  const isAssistant = m.role === 'assistant';
  const isUser = m.role === 'user';
  const usage = formatUsage(m);
  const meta =
    isUser || isAssistant
      ? isAssistant && m.model
        ? `${formatClock(m.timestamp)} · ${m.model}${usage ? ` · ${usage}` : ''}`
        : [formatClock(m.timestamp), usage].filter(Boolean).join(' · ')
      : undefined;
  return {
    key: m.id,
    ts: m.timestamp,
    type: m.role === 'user' ? 'user' : m.role === 'system' ? 'sys' : 'ai',
    content: m.content,
    ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    isStreaming: streaming && isLast && isAssistant && m.content !== '',
    thinking: streaming && isLast && isAssistant && m.content === '',
    meta,
  };
}

export default function Terminal({ session, extras, clearedBefore, pending, onApprove, onReject }: Props) {
  const streaming = useSessionStore((s) => s.isStreaming);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const view = useMemo<ViewLine[]>(() => {
    if (!session) return [];
    const out: ViewLine[] = [];
    const msgs =
      clearedBefore == null
        ? session.messages
        : session.messages.filter((m) => m.timestamp >= clearedBefore);
    msgs.forEach((m, i) => out.push(toViewLine(m, streaming, i === msgs.length - 1)));
    // Extras her zaman en sonda: pushExtra Date.now() damgalıdır, mesajlar kronolojiktir.
    // O(n log n) sort her token'da yeniden koşuyordu — birleştirme yeterli.
    for (const e of extras) {
      out.push({
        key: e.id,
        ts: e.ts,
        type: e.type,
        content: e.content,
        meta:
          e.type === 'err' || e.type === 'warn' || e.type === 'user'
            ? formatClock(e.ts)
            : undefined,
      });
    }
    return out;
  }, [session, extras, clearedBefore, streaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    setShowJump(false);
    el.scrollTop = el.scrollHeight;
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const stuck = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickRef.current = stuck;
    setShowJump(!stuck && el.scrollHeight > el.clientHeight + 40);
  };

  // Kasıtlı depsiz: streaming'de her render'da alta yapışmayı korur.
  // setShowJump aynı değerde bail-out yapar; yine de gereksiz yazmayı önle.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    } else if (el) {
      const shouldShow = el.scrollHeight > el.clientHeight + 40;
      setShowJump((prev) => (prev === shouldShow ? prev : shouldShow));
    }
  });

  useEffect(() => {
    stickRef.current = true;
    setShowJump(false);
  }, [session?.id]);

  // Faz 8 L4: görev listesi geçmişten türetilir (kalıcı katman ayrı tutulmaz).
  const todoItems = useMemo(
    () => deriveTodoState(session?.messages ?? []).items,
    [session?.messages],
  );

  return (
    <div className="terminal-wrap">
      <div className="terminal" ref={scrollRef} onScroll={onScroll}>
        <div className="terminal-view" key={session?.id ?? 'none'}>
          {!session && (
            <div className="msg msg-sys">
              <span className="msg-body msg-text">/// session yok — + new ile başlat</span>
            </div>
          )}
          {view.map((l) => (
            <MessageLine
              key={l.key}
              type={l.type}
              content={l.content}
              images={l.images}
              isStreaming={l.isStreaming}
              thinking={l.thinking}
              meta={l.meta}
              reasoning={l.reasoning}
              showThinking={showThinking}
            />
          ))}
          {/* Faz 8 L4: görev listesi (todo/plan) mesajların sonunda gösterilir. */}
          {todoItems.length > 0 && (
            <div className="msg msg-sys" key="todo-panel">
              <span className="msg-body msg-text">
                {`/// görevler (${todoItems.filter((t) => t.done).length}/${todoItems.length}):`}
                <br />
                {todoItems.map((t) => `  ${t.done ? '[x]' : '[ ]'} ${t.id} ${t.text}`).join('\n')}
              </span>
            </div>
          )}
          {(pending ?? []).map((p) => {
            // O1 (Faz 4): exec'te komut kırpmadan, cmd + args ayrı gösterilir;
            // yapı gereği kod çalıştıran komutlarda açık uyarı satırı var.
            const isExec = p.call.name === 'exec';
            const eArgs = p.call.args ?? {};
            const execCmd = typeof eArgs.cmd === 'string' ? eArgs.cmd : '';
            const execArgList = Array.isArray(eArgs.args)
              ? (eArgs.args as unknown[]).filter((a): a is string => typeof a === 'string')
              : [];
            const warning = isExec ? execApprovalWarning(execCmd, execArgList) : null;
            const shown = isExec
              ? `exec · ${execCmd} ${execArgList.join(' ')}`
              : `${String(p.call.name)} ${JSON.stringify(p.call.args) ?? ''}`.slice(0, 240);
            return (
              <div className="msg msg-sys" key={`pending-${p.id}`}>
                <span className="msg-body msg-text">
                  {`⏸ onay bekleniyor: ${shown.trim()}`}
                  {warning && (
                    <>
                      <br />
                      <span style={{ color: 'var(--col-warn)' }}>{`⚠ ${warning}`}</span>
                    </>
                  )}
                  <span style={{ marginLeft: 8 }}>
                    <button className="btn-send" onClick={onApprove} title="onayla (Enter)">
                      [ONAYLA ✓ Enter]
                    </button>{' '}
                    <button className="btn-send btn-stop" onClick={onReject} title="reddet (Esc)">
                      [REDDET ✗ Esc]
                    </button>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {showJump && (
        <button className="jump-latest" onClick={scrollToBottom} title="en son mesaja git">
          ↓ yeni mesaj
        </button>
      )}
    </div>
  );
}
