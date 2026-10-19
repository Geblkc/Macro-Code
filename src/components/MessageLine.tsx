import { useEffect, useRef } from 'react';
import { renderMarkdown } from '../lib/markdown';
import type { LineType } from '../types';

interface Props {
  type: LineType;
  content: string;
  images?: string[];
  isStreaming?: boolean;
  thinking?: boolean;
  meta?: string;
  reasoning?: string;
  showThinking?: boolean;
}

// user/ai prefixleri burada eklenir; sys/err/warn icerigi isaretini tasir.
const PREFIX: Record<LineType, string> = {
  user: '❯',
  ai: '◆',
  sys: '',
  err: '',
  warn: '',
};

export default function MessageLine({ type, content, images, isStreaming, thinking, meta, reasoning, showThinking }: Props) {
  const mdRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (type !== 'ai' || thinking || !mdRef.current) return;
    const host = mdRef.current;
    host.replaceChildren();
    host.appendChild(renderMarkdown(content, host.ownerDocument));
  }, [type, content, thinking]);

  const showReasoning = type === 'ai' && showThinking !== false && !!reasoning?.trim();

  return (
    <div className={`msg msg-${type} msg-in`}>
      {PREFIX[type] && <span className="msg-prefix">{PREFIX[type]}</span>}
      {showReasoning && (
        <details className="reasoning">
          <summary>⠿ düşünüyor</summary>
          <pre className="reasoning-body">{reasoning}</pre>
        </details>
      )}
      {type === 'ai' ? (
        thinking ? (
          <span className="msg-body thinking">düşünüyor</span>
        ) : (
          <div ref={mdRef} className="msg-body" />
        )
      ) : (
        <span className="msg-body msg-text">{content}</span>
      )}
      {images && images.length > 0 && (
        <div className="msg-images">
          {images.map((src, i) => (
            <img key={i} src={src} alt={`görsel ${i + 1}`} />
          ))}
        </div>
      )}
      {meta && !thinking && <span className="msg-meta">{meta}</span>}
      {isStreaming && !thinking && <span className="cursor" />}
    </div>
  );
}
