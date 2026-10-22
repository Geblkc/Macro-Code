import { memo, useEffect, useRef } from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { LineType } from '../types';
import { useT } from '../lib/i18n';
import { Icon } from './icons';

interface Props {
  type: LineType;
  content: string;
  images?: string[];
  isStreaming?: boolean;
  thinking?: boolean;
  meta?: string;
  reasoning?: string;
  showThinking?: boolean;
  /** Mesaj eylemleri (kopyala / yeniden üret). */
  onCopy?: (text: string) => void;
}

// user/ai prefixleri burada eklenir; sys/err/warn icerigi isaretini tasir.
const PREFIX: Record<LineType, string> = {
  user: '❯',
  ai: '◆',
  sys: '',
  err: '',
  warn: '',
};

function MessageLineInner({
  type,
  content,
  images,
  isStreaming,
  thinking,
  meta,
  reasoning,
  showThinking,
  onCopy,
}: Props) {
  const t = useT();
  const mdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (type !== 'ai' || thinking || !mdRef.current) return;
    const host = mdRef.current;
    host.replaceChildren();
    host.appendChild(renderMarkdown(content, host.ownerDocument));
  }, [type, content, thinking]);

  const showReasoning = type === 'ai' && showThinking !== false && !!reasoning?.trim();

  // sys/err/warn satırları kendi gövde biçimini taşır.
  // İşaret (/// · ✗ · !) içerikte gelir; gutter'a taşınır (çift işaret olmaz).
  if (type === 'sys' || type === 'err' || type === 'warn') {
    const prefix = type === 'err' ? '✗' : type === 'warn' ? '!' : '///';
    const body = content.replace(/^(\/\/\/|✗|!)\s*/, '');
    return (
      <div className={`msg msg-${type}`}>
        <div className="gutter" aria-hidden="true">
          {prefix}
        </div>
        <div className="body-col">
          <div className={type === 'sys' ? 'logline' : `log-${type}`}>{body}</div>
        </div>
        {meta ? <div className="meta-col">{meta}</div> : <div className="meta-col" />}
      </div>
    );
  }

  return (
    <div className={`msg msg-${type}`}>
      <div className="gutter" aria-hidden="true">
        {PREFIX[type]}
      </div>

      <div className="body-col">
        {showReasoning && (
          <details className="reasoning">
            <summary>
              <Icon name="spark" size="sm" />
              {t('message.thinking')}
              <Icon name="chevron-down" size="sm" className="chev" />
            </summary>
            <pre className="reasoning-body">{reasoning}</pre>
          </details>
        )}

        {type === 'ai' ? (
          thinking ? (
            <span className="thinking">
              <span className="thinking-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="sr-only">{t('message.thinking')}</span>
            </span>
          ) : (
            <div ref={mdRef} className={`card-ai${isStreaming ? ' streaming' : ''}`} />
          )
        ) : (
          <div className="card-user">{content}</div>
        )}

        {images && images.length > 0 && (
          <div className="msg-images">
            {images.map((src, i) => (
              <img key={i} src={src} alt={t('message.imageAlt', { n: i + 1 })} />
            ))}
          </div>
        )}
      </div>

      {meta ? <div className="meta-col">{meta}</div> : <div className="meta-col" />}

      {onCopy && content ? (
        <div className="msg-actions">
          <button
            className="msg-action"
            title={t('message.copy')}
            aria-label={t('message.copy')}
            onClick={() => onCopy(content)}
          >
            <Icon name="copy" size="sm" />
          </button>
        </div>
      ) : null}

      {isStreaming && !thinking ? <span className="caret" aria-hidden="true" /> : null}
    </div>
  );
}

/**
 * Tamamlanmış mesajlar yeniden render edilmesin (streaming sırasında
 * yalnız son mesaj değişir). `meta` ve `reasoning` de karşılaştırılır.
 */
export default memo(MessageLineInner, (a, b) => {
  return (
    a.type === b.type &&
    a.content === b.content &&
    a.isStreaming === b.isStreaming &&
    a.thinking === b.thinking &&
    a.meta === b.meta &&
    a.reasoning === b.reasoning &&
    a.showThinking === b.showThinking &&
    a.images === b.images &&
    a.onCopy === b.onCopy
  );
});
