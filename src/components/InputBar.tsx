import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyHistory } from '../hooks/useKeyHistory';
import { Icon } from './icons';

interface Props {
  onSend: (text: string, images: string[]) => void;
  onAbort: () => void;
  onClear: () => void;
  streaming: boolean;
  pendingCount?: number;
  onApprove?: () => void;
  onReject?: () => void;
}

const MAX_HEIGHT = 160;
const MAX_IMAGES = 4;
const MAX_DIM = 1568;

/** Görseli küçültüp JPEG data URL yapar (token/maliyet güvenliği). */
function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas yok');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('görsel okunamadı'));
    };
    img.src = url;
  });
}

export default function InputBar({
  onSend,
  onAbort,
  onClear,
  streaming,
  pendingCount,
  onApprove,
  onReject,
}: Props) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const { push, move } = useKeyHistory();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const autoresize = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    autoresize();
  }, [value, autoresize]);

  const submit = useCallback(() => {
    const text = value.trim();
    if ((!text && pending.length === 0) || streaming) return;
    if (text) push(text);
    setValue('');
    setPending([]);
    setAttachErr(null);
    onSend(text, pending);
    requestAnimationFrame(() => areaRef.current?.focus());
  }, [value, pending, streaming, push, onSend]);

  const onFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setAttachErr(null);
      const room = MAX_IMAGES - pending.length;
      if (room <= 0) {
        setAttachErr(`en fazla ${MAX_IMAGES} görsel`);
        return;
      }
      const batch = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room);
      if (batch.length === 0) {
        setAttachErr('yalnızca görsel dosyası');
        return;
      }
      try {
        const urls = await Promise.all(batch.map(downscaleImage));
        setPending((p) => [...p, ...urls].slice(0, MAX_IMAGES));
      } catch {
        setAttachErr('görsel işlenemedi');
      }
    },
    [pending.length],
  );

  const moveHistory = useCallback(
    (dir: 'up' | 'down', current: string) => {
      const next = move(dir, current);
      setValue(next);
      requestAnimationFrame(() => {
        const el = areaRef.current;
        if (el) el.selectionStart = el.selectionEnd = next.length;
      });
    },
    [move],
  );

  const approxTokens = Math.ceil(value.trim().length / 4);
  const canSend = (value.trim().length > 0 || pending.length > 0) && !streaming;
  const hasPending = (pendingCount ?? 0) > 0;

  return (
    <div className="inputbar">
      <div className="inputbar-inner">
        {pending.length > 0 && (
          <div className="pending-images">
            {pending.map((url, i) => (
              <span key={i} className="pending-thumb">
                <img src={url} alt={`ek ${i + 1}`} />
                <button
                  className="pending-remove"
                  title="kaldır"
                  aria-label={`${i + 1}. görseli kaldır`}
                  onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size="sm" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="input-row">
          <span className="prompt" aria-hidden="true">
            ❯
          </span>
          <textarea
            ref={areaRef}
            className="inputbar-field"
            value={value}
            rows={1}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            aria-label="Mesaj girişi"
            placeholder={streaming ? 'yanıt bekleniyor…' : 'mesajını yaz veya /help yaz'}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              // Faz 1 K2: boş girişte Enter onayla / Esc reddet (döngü kırılmaz).
              if (hasPending && value.trim() === '') {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onApprove?.();
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  onReject?.();
                  return;
                }
              } else if (hasPending && e.key === 'Escape') {
                e.preventDefault();
                onReject?.();
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              } else if (e.key === 'ArrowUp' && !e.shiftKey) {
                const before = value.slice(0, e.currentTarget.selectionStart ?? 0);
                if (before.includes('\n')) return;
                e.preventDefault();
                moveHistory('up', value);
              } else if (e.key === 'ArrowDown' && !e.shiftKey) {
                const after = value.slice(e.currentTarget.selectionEnd ?? value.length);
                if (after.includes('\n')) return;
                e.preventDefault();
                moveHistory('down', value);
              } else if (e.key === 'l' && e.ctrlKey) {
                e.preventDefault();
                onClear();
              }
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {!streaming && (
            <button
              className="attach-btn"
              title="görsel ekle (en fazla 4)"
              aria-label="Görsel ekle"
              disabled={streaming || pending.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="image" size="sm" />
            </button>
          )}
          {streaming ? (
            <button className="btn btn-danger btn-sm" onClick={onAbort} title="durdur">
              <Icon name="square" size="sm" />
              Dur
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              disabled={!canSend}
              onClick={submit}
              title="gönder (Enter)"
            >
              Gönder
            </button>
          )}
        </div>

        <div className="inputbar-meta">
          <span className="keys">
            {hasPending ? (
              <span className="warn-text">
                {pendingCount} onay bekleniyor · Enter onayla · Esc reddet
              </span>
            ) : (
              <>
                <span>
                  <kbd>Enter</kbd> gönder
                </span>
                <span>
                  <kbd>Shift+Enter</kbd> satır
                </span>
                <span>
                  <kbd>↑↓</kbd> geçmiş
                </span>
                <span>
                  <kbd>Ctrl+L</kbd> temizle
                </span>
              </>
            )}
            {attachErr ? <span className="warn-text">{attachErr}</span> : null}
          </span>
          <span>
            {value.length} karakter · ~{approxTokens} token
            {pending.length > 0 ? ` · ${pending.length} görsel` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
