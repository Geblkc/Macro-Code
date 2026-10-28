import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useKeyHistory } from '../hooks/useKeyHistory';
import { useT } from '../lib/i18n';
import { filterCommands, type CommandSpec } from '../lib/commands';
import { Icon } from './icons';

interface Props {
  onSend: (text: string, images: string[]) => void;
  onAbort: () => void;
  onClear: () => void;
  streaming: boolean;
  pendingCount?: number;
  onApprove?: () => void;
  onReject?: () => void;
  /** Dışarıdan odak tetiklemesi (arama kapanınca giriş alanına dönüş vb.). */
  focusRef?: MutableRefObject<(() => void) | null>;
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
  focusRef,
}: Props) {
  const t = useT();
  const [value, setValue] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [cmdIdx, setCmdIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const { push, move } = useKeyHistory();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Sürükle-bırak derinliği: çocuk elemanlardan geçen dragleave ile titremesin. */
  const dragDepthRef = useRef(0);

  /** Popup yalnızca tek satırlık `'/' + komut adı` yazımında açıktır (boşluk = argüman aşaması). */
  const cmdQuery = useMemo(() => (/^\s*\/[^\s]*$/.test(value) ? value.trim().toLowerCase() : null), [value]);
  const cmdSuggestions = useMemo(
    () => (cmdQuery === null ? [] : filterCommands(cmdQuery)),
    [cmdQuery],
  );
  const cmdOpen = cmdQuery !== null && !dismissed && cmdSuggestions.length > 0;

  // Yeni sorgu → seçim başa döner, kapatma (dismiss) sıfırlanır; sorgu silinip
  // yeniden yazıldığında popup taze davranır.
  useEffect(() => {
    setCmdIdx(0);
    setDismissed(false);
  }, [cmdQuery]);

  // Seçili satır görünür kalsın (klavye gezinmesinde listelerin dışına taşmaz).
  useEffect(() => {
    if (!cmdOpen) return;
    menuRef.current
      ?.querySelector(`[data-cmd-i="${cmdIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cmdIdx, cmdOpen]);

  /** Tamamlama metni: komut + argüman alanı varsa boşluk bırakılır. */
  const fillOf = useCallback((c: CommandSpec) => `/${c.name}${c.args ? ' ' : ''}`, []);

  const autoresize = useCallback(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    autoresize();
  }, [value, autoresize]);

  // Dışarıdan odak: arama kapanınca yazmaya doğrudan devam (Ctrl+F akışı).
  useEffect(() => {
    if (focusRef) focusRef.current = () => areaRef.current?.focus();
  }, [focusRef]);

  /**
   * Gönderi. Ham metin verilmezse alanın güncel değerini kullanır
   * (popup Enter birleştirmesi güncel state'i beklememesi için override'lı).
   */
  const submit = useCallback(
    (raw?: string) => {
      const text = (raw ?? value).trim();
      if ((!text && pending.length === 0) || streaming) return;
      if (text) push(text);
      setValue('');
      setPending([]);
      setAttachErr(null);
      onSend(text, pending);
      requestAnimationFrame(() => areaRef.current?.focus());
    },
    [value, pending, streaming, push, onSend],
  );

  /** Öneriden seçim: zorunlu argümanlı komutlar tamamlanır, diğerleri doğrudan gönderilir. */
  const pickCommand = useCallback(
    (c: CommandSpec) => {
      if (c.requiresArg) {
        setValue(fillOf(c));
        requestAnimationFrame(() => {
          const el = areaRef.current;
          if (el) el.selectionStart = el.selectionEnd = fillOf(c).length;
        });
      } else {
        submit(fillOf(c));
      }
      setDismissed(true);
    },
    [fillOf, submit],
  );

  /**
   * Tek görsel ekleme hattı (Faz 5): buton dosya seçici, panodan yapıştırma
   * ve sürükle-bırak hep buradan geçer — kurallar tek yerde, çift davranış yok.
   * Kurallar: yalnız `image/*`, odaya göre dilim (max 4), ≤1568px JPEG.
   */
  const attachImages = useCallback(
    async (files: FileList | File[] | null) => {
      if (!files || files.length === 0) return;
      setAttachErr(null);
      const room = MAX_IMAGES - pending.length;
      if (room <= 0) {
        setAttachErr(t('input.maxImages', { count: MAX_IMAGES }));
        return;
      }
      const batch = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room);
      if (batch.length === 0) {
        setAttachErr(t('input.onlyImages'));
        return;
      }
      try {
        const urls = await Promise.all(batch.map(downscaleImage));
        setPending((p) => [...p, ...urls].slice(0, MAX_IMAGES));
      } catch {
        setAttachErr(t('input.imageFailed'));
      }
    },
    [pending.length, t],
  );

  // ── Sürükle-bırak (Faz 5): yalnız dosya sürükleme vurgulanır. ──
  // preventDefault her koşulda yapılır — aksi hâlde webview dosyayı açmaya çalışır;
  // streaming'de buton gizliyken de bırakma yok sayılır.
  const onDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      if (!streaming) setDragOver(true);
    },
    [streaming],
  );
  const onDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!streaming) setDragOver(true);
    },
    [streaming],
  );
  const onDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      if (streaming) return; // buton gizliyken kabul edilmediği gibi
      void attachImages(e.dataTransfer.files);
    },
    [streaming, attachImages],
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
      <div
        className={`inputbar-inner${dragOver ? ' dropping' : ''}`}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && (
          <div className="drop-hint" role="status">
            {t('input.dropHint')}
          </div>
        )}
        {pending.length > 0 && (
          <div className="pending-images">
            {pending.map((url, i) => (
              <span key={i} className="pending-thumb">
                <img src={url} alt={t('input.imageAlt', { n: i + 1 })} />
                <button
                  className="pending-remove"
                  title={t('input.removeImage')}
                  aria-label={t('input.removeImageAria', { n: i + 1 })}
                  onClick={() => setPending((p) => p.filter((_, j) => j !== i))}
                >
                  <Icon name="x" size="sm" />
                </button>
              </span>
            ))}
          </div>
        )}

        {cmdOpen && (
          <div
            className="cmd-menu"
            role="listbox"
            aria-label={t('input.slashMenuAria')}
            ref={menuRef}
          >
            <div className="cmd-menu-list">
              {cmdSuggestions.map((c, i) => (
                <div
                  key={c.name}
                  data-cmd-i={i}
                  role="option"
                  aria-selected={i === cmdIdx}
                  className={`cmd-item${i === cmdIdx ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    // Alan odaklanmayı korunsun (blur → kapanış yarışını engeller).
                    e.preventDefault();
                    setCmdIdx(i);
                    pickCommand(c);
                  }}
                  onMouseEnter={() => setCmdIdx(i)}
                >
                  <span className="cmd-name">/{c.name}</span>
                  {c.args ? <span className="cmd-args">{c.args}</span> : null}
                  <span className="cmd-desc">{t(c.descKey, c.descParams)}</span>
                </div>
              ))}
            </div>
            <div className="cmd-menu-foot" aria-hidden="true">
              {t('input.cmdHint')}
            </div>
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
            aria-label={t('input.ariaLabel')}
            placeholder={streaming ? t('input.placeholderWaiting') : t('input.placeholder')}
            onChange={(e) => setValue(e.target.value)}
            onPaste={(e) => {
              // Panoda görsel varsa düz metin yapıştırma yerine görsel hattı
              // çalışır (Faz 5) — streaming'de buton gizliyken de yok sayılır.
              const items = e.clipboardData?.items;
              if (!items) return;
              const imgs: File[] = [];
              for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                  const f = item.getAsFile();
                  if (f) imgs.push(f);
                }
              }
              if (imgs.length === 0) return;
              e.preventDefault();
              if (streaming) return;
              void attachImages(imgs);
            }}
            onKeyDown={(e) => {
              // IME bestesi sırasında tuşlar uygulamaya sızmasın:
              // Enter göndermesin, ↑↓ geçmişi çağırmasın (Faz 4).
              if (e.nativeEvent.isComposing) return;
              // K2: boş girişte Enter onayla / Esc reddet (döngü kırılmaz).
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
              // Slash önerisi: açıkken temel girişin tuşlarını devralır.
              if (cmdOpen) {
                const sel = cmdSuggestions[Math.min(cmdIdx, cmdSuggestions.length - 1)];
                if (e.key === 'ArrowDown' && !e.shiftKey) {
                  e.preventDefault();
                  setCmdIdx((i) => Math.min(i + 1, cmdSuggestions.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp' && !e.shiftKey) {
                  e.preventDefault();
                  setCmdIdx((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  setValue(fillOf(sel));
                  setDismissed(true);
                  return;
                }
                if (
                  e.key === 'ArrowRight' &&
                  (e.currentTarget.selectionStart ?? 0) === value.length &&
                  (e.currentTarget.selectionEnd ?? 0) === value.length
                ) {
                  // İmleç sonda: sağa hareket komut tamamlamaya döner (terminal davranışı).
                  e.preventDefault();
                  setValue(fillOf(sel));
                  setDismissed(true);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setDismissed(true);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  pickCommand(sel);
                  return;
                }
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
              void attachImages(e.target.files);
              e.target.value = '';
            }}
          />
          {!streaming && (
            <button
              className="attach-btn"
              title={t('input.attachTitle', { count: MAX_IMAGES })}
              aria-label={t('input.addImage')}
              disabled={streaming || pending.length >= MAX_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="image" size="sm" />
            </button>
          )}
          {streaming ? (
            <button className="btn btn-danger btn-sm" onClick={onAbort} title={t('input.stopTitle')}>
              <Icon name="square" size="sm" />
              {t('input.stop')}
            </button>
          ) : (
            <button
              className="btn btn-primary btn-sm"
              disabled={!canSend}
              onClick={() => submit()}
              title={t('input.sendTitle')}
            >
              {t('input.send')}
            </button>
          )}
        </div>

        <div className="inputbar-meta">
          <span className="keys">
            {hasPending ? (
              <span className="warn-text">
                {t('input.pendingHint', { count: pendingCount ?? 0 })}
              </span>
            ) : (
              <>
                <span>
                  <kbd>Enter</kbd> {t('input.hint.send')}
                </span>
                <span>
                  <kbd>Shift+Enter</kbd> {t('input.hint.newline')}
                </span>
                <span>
                  <kbd>↑↓</kbd> {t('input.hint.history')}
                </span>
                <span>
                  <kbd>/</kbd> {t('input.hint.commands')}
                </span>
                <span>
                  <kbd>Ctrl+L</kbd> {t('input.hint.clear')}
                </span>
                <span>
                  <kbd>Ctrl+N</kbd> {t('input.hint.newSession')}
                </span>
              </>
            )}
            {attachErr ? <span className="warn-text">{attachErr}</span> : null}
          </span>
          <span>
            {t('input.meta', { count: value.length, tokens: approxTokens })}
            {pending.length > 0 ? t('input.metaImages', { count: pending.length }) : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
