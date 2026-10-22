import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MessageLine from './MessageLine';
import ToolCallCard from './ToolCallCard';
import ApprovalCard from './ApprovalCard';
import TaskPanel from './TaskPanel';
import Welcome from './Welcome';
import type { ExtraLine, Message, Session, TerminalLine, ToolEvent } from '../types';
import type { PendingApproval } from '../lib/engine/approvals';
import { execApprovalWarning } from '../lib/engine/policy';
import { useSessionStore } from '../store/session';
import { useSettingsStore } from '../store/settings';
import { deriveTodoState } from '../lib/engine/tools/todo';
import { useT } from '../lib/i18n';
import { Icon } from './icons';

interface Props {
  session: Session | null;
  extras: ExtraLine[];
  clearedBefore: number | null;
  pending?: PendingApproval[];
  onApprove?: () => void;
  onReject?: () => void;
  /** "Her zaman çalıştır" kutusu (komut metni ile çağrılır). */
  onAlwaysAllow?: (command: string) => void;
  /** Zaman damgası biçimi. */
  clockFormat: '24h' | '12h';
  /** Zaman damgası gösterilsin mi (görünüm ayarı). */
  showTimestamps: boolean;
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
  tool?: ToolEvent;
}

function formatClock(ts: number, fmt: '24h' | '12h'): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  if (fmt === '12h') {
    const h = d.getHours() % 12 || 12;
    return `${h}:${pad(d.getMinutes())}`;
  }
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

function toViewLine(
  m: Message,
  streaming: boolean,
  isLast: boolean,
  clockFormat: '24h' | '12h',
  showTimestamps: boolean,
): ViewLine {
  const isAssistant = m.role === 'assistant';
  const isUser = m.role === 'user';
  const usage = formatUsage(m);
  // Meta kolonu çok satırlı (sağa hizalı): saat / model / token.
  const meta =
    isUser || isAssistant
      ? [
          showTimestamps ? formatClock(m.timestamp, clockFormat) : '',
          isAssistant && m.model ? m.model : '',
          usage ?? '',
        ]
          .filter(Boolean)
          .join('\n')
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

export default function Terminal({
  session,
  extras,
  clearedBefore,
  pending,
  onApprove,
  onReject,
  onAlwaysAllow,
  clockFormat,
  showTimestamps,
}: Props) {
  const t = useT();
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
    msgs.forEach((m, i) =>
      out.push(toViewLine(m, streaming, i === msgs.length - 1, clockFormat, showTimestamps)),
    );

    // Extras her zaman en sonda: pushExtra Date.now() damgalıdır, mesajlar kronolojiktir.
    // Araç çağrısı + sonucu aynı kartta birleşir (id eşleşmesi).
    const toolIndex = new Map<string, number>();
    for (const e of extras) {
      if (e.tool) {
        const prev = toolIndex.get(e.tool.id);
        if (prev !== undefined) {
          const merged = out[prev];
          out[prev] = {
            ...merged,
            tool: {
              ...merged.tool!,
              status: e.tool.status,
              output: e.tool.output ?? merged.tool!.output,
              args: merged.tool!.args || e.tool.args,
            },
            content: e.content,
          };
          continue;
        }
        toolIndex.set(e.tool.id, out.length);
        out.push({
          key: e.id,
          ts: e.ts,
          type: e.type,
          content: e.content,
          tool: e.tool,
          meta:
            showTimestamps && (e.type === 'err' || e.type === 'warn')
              ? formatClock(e.ts, clockFormat)
              : undefined,
        });
        continue;
      }
      out.push({
        key: e.id,
        ts: e.ts,
        type: e.type,
        content: e.content,
        meta:
          showTimestamps && (e.type === 'err' || e.type === 'warn' || e.type === 'user')
            ? formatClock(e.ts, clockFormat)
            : undefined,
      });
    }
    return out;
  }, [session, extras, clearedBefore, streaming, clockFormat, showTimestamps]);

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

  // Faz 8 L4: görev listesi (todo/plan) mesajların sonunda gösterilir.
  const todoItems = useMemo(
    () => deriveTodoState(session?.messages ?? []).items,
    [session?.messages],
  );

  // Boş oturum → karşılama ekranı.
  const isEmpty =
    !!session &&
    view.length === 0 &&
    (pending ?? []).length === 0 &&
    todoItems.length === 0;

  return (
    <div className="terminal-wrap">
      <div className="terminal" ref={scrollRef} onScroll={onScroll}>
        {isEmpty ? (
          <Welcome />
        ) : (
          <div className="terminal-view" key={session?.id ?? 'none'}>
            {!session && (
              <div className="msg msg-sys">
                <div className="gutter" aria-hidden="true">
                  ///
                </div>
                <div className="body-col">
                  <div className="logline">{t('terminal.noSession')}</div>
                </div>
                <div className="meta-col" />
              </div>
            )}

            {view.map((l) =>
              l.tool ? (
                <div className="msg msg-tool" key={l.key}>
                  <div className="gutter" aria-hidden="true">
                    ▸
                  </div>
                  <div className="body-col">
                    <ToolCallCard tool={l.tool} />
                  </div>
                  <div className="meta-col">{l.meta}</div>
                </div>
              ) : (
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
              ),
            )}

            {todoItems.length > 0 && (
              <div className="msg msg-sys" key="todo-panel">
                <div className="gutter" aria-hidden="true">
                  ☑
                </div>
                <div className="body-col">
                  <TaskPanel
                    items={todoItems.map((t, i) => ({
                      id: t.id,
                      text: t.text,
                      done: t.done,
                      active: !t.done && todoItems.findIndex((x) => !x.done) === i,
                    }))}
                  />
                </div>
                <div className="meta-col" />
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
              // Onay kartı araç adını kendi başlığında gösterir; burada
              // yalnız komut/argüman yer alır (çift yazım olmaz).
              const shown = isExec
                ? `${execCmd} ${execArgList.join(' ')}`.trim()
                : (JSON.stringify(p.call.args) ?? '').slice(0, 240);
              return (
                <div className="msg msg-warn" key={`pending-${p.id}`}>
                  <div className="gutter" aria-hidden="true">
                    !
                  </div>
                  <div className="body-col">
                    <ApprovalCard
                      callName={String(p.call.name)}
                      detail={shown}
                      warning={warning}
                      onApprove={onApprove}
                      onReject={onReject}
                      onAlways={
                        isExec && onAlwaysAllow
                          ? // O7 düzeltmesi: yalnız komut adı DEĞİL, tam satır
                            // (`git commit -m x`) allowlist'e yazılır. Eskiden
                            // `execCmd` (örn. "git") yazılıyordu → tüm argümanlar
                            // kalıcı olarak onaysız geçer oluyordu.
                            () => onAlwaysAllow(shown)
                          : undefined
                      }
                    />
                  </div>
                  <div className="meta-col" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showJump && (
        <button className="jump-latest" onClick={scrollToBottom} title={t('terminal.jumpTitle')}>
          <Icon name="chevron-down" size="sm" />
          {t('terminal.newMessage')}
        </button>
      )}
    </div>
  );
}
