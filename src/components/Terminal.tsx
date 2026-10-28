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
import { findHits, stepHit } from '../lib/search';
import { useCopy } from '../hooks/useCopy';
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
  /** /root akışı → Welcome ipucu butonuna aktarılır. */
  onRootCommand?: (arg: string) => void;
  /** Zaman damgası biçimi. */
  clockFormat: '24h' | '12h';
  /** Zaman damgası gösterilsin mi (görünüm ayarı). */
  showTimestamps: boolean;
  /** Arama kapanınca giriş alanına odak döner (Ctrl+F akışının devamı). */
  onFocusInput?: () => void;
  /** Ayarlar modalı açıkken Ctrl+F devre dışı (varsayılan: etkin). */
  searchEnabled?: boolean;
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
  /** Faz 4: hata satırı "tekrar dene" eylemi (extras'tan taşınır). */
  retry?: () => void;
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
  onRootCommand,
  clockFormat,
  showTimestamps,
  onFocusInput,
  searchEnabled = true,
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
        ...(e.retry ? { retry: e.retry } : {}),
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

  // ── Konuşma içi arama (Ctrl+F): satır bazlı — lib/search.ts saf fonksiyonları ──
  const copy = useCopy();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hitIdx, setHitIdx] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(
    () => findHits(view.map((l) => ({ key: l.key, text: l.content })), query),
    [view, query],
  );
  // Yazarken satırlar azalabilir (streaming/extras) — indeks güvenli tutulur.
  const curHit = hits.length === 0 ? -1 : Math.min(hitIdx, hits.length - 1);

  const scrollToKey = useCallback((key: string) => {
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector(`[data-line-key="${CSS.escape(key)}"]`);
    if (!(target instanceof HTMLElement)) return;
    // Streaming yapışması arama sırasında kapatılır ki autoscroll yarışmasın.
    stickRef.current = false;
    target.scrollIntoView({ block: 'center' });
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setHitIdx(0);
    onFocusInput?.();
  }, [onFocusInput]);

  // Ctrl+F: global yakalanır (giriş alanı odakta bile); ayarlar modalı açıkken pasif.
  useEffect(() => {
    if (!searchEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      // IME bestesi sırasında kısayollar tetiklenmez (Faz 4).
      if (e.isComposing) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchRef.current?.select());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchEnabled]);

  // Oturum değişince arama kapanır (eski oturumun eşleşmeleri anlamsız).
  useEffect(() => {
    setSearchOpen(false);
    setQuery('');
    setHitIdx(0);
  }, [session?.id]);

  // Eşleşme değişimi → aktif satır ortalanır (yazarken ilk eşleşmeye atlar).
  useEffect(() => {
    if (!searchOpen || curHit < 0) return;
    scrollToKey(hits[curHit].key);
  }, [searchOpen, curHit, hits, scrollToKey]);

  /** Satır vurgusu: eşleşen satır `match-hit`, aktif eşleşme `match-current` (O(1) lookup). */
  const hitMap = useMemo(() => {
    const m = new Map<string, 'hit' | 'current'>();
    hits.forEach((h, i) => m.set(h.key, i === curHit ? 'current' : 'hit'));
    return m;
  }, [hits, curHit]);

  const rowMarks = useCallback(
    (key: string): string | undefined => {
      const v = hitMap.get(key);
      return v === 'current' ? 'match-hit match-current' : v === 'hit' ? 'match-hit' : undefined;
    },
    [hitMap],
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
          <Welcome onRootCommand={onRootCommand} />
        ) : (
          <div
            className="terminal-view"
            key={session?.id ?? 'none'}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
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

            {view.map((l) => {
              const marks = rowMarks(l.key);
              return l.tool ? (
                <div
                  className={`msg msg-tool${marks ? ` ${marks}` : ''}`}
                  data-line-key={l.key}
                  key={l.key}
                >
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
                  onCopy={copy}
                  onRetry={l.retry}
                  className={marks}
                  dataLineKey={l.key}
                />
              );
            })}

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

      {searchEnabled && searchOpen && (
        <div className="term-search" role="search">
          <Icon name="search" size="sm" className="term-search-icon" />
          <input
            ref={searchRef}
            className="term-search-field"
            type="text"
            value={query}
            spellCheck={false}
            autoComplete="off"
            aria-label={t('terminal.searchAria')}
            placeholder={t('terminal.searchPlaceholder')}
            onChange={(e) => {
              setQuery(e.target.value);
              setHitIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits.length > 0) {
                e.preventDefault();
                setHitIdx(stepHit(hits, curHit, e.shiftKey ? -1 : 1));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <span className="term-search-count" aria-live="polite">
            {t('terminal.searchCount', {
              current: hits.length === 0 ? 0 : curHit + 1,
              total: hits.length,
            })}
          </span>
          <span className="term-search-hint" aria-hidden="true">
            {t('terminal.searchHint')}
          </span>
          <button
            className="term-search-close"
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={closeSearch}
          >
            <Icon name="x" size="sm" />
          </button>
        </div>
      )}

      {showJump && (
        <button className="jump-latest" onClick={scrollToBottom} title={t('terminal.jumpTitle')}>
          <Icon name="chevron-down" size="sm" />
          {t('terminal.newMessage')}
        </button>
      )}
    </div>
  );
}
