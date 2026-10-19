/**
 * MacroCode — İkon seti
 *
 * Tek kaynak: 16×16 ızgara, 1.5px stroke, `currentColor`, dolgu yok.
 * Emoji KULLANILMAZ (tutarlı tipografik dil için).
 *
 * Kullanım:  <Icon name="wrench" />  ·  <Icon name="copy" size="sm" />
 */

import type { ReactNode } from 'react';

export type IconName =
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'search'
  | 'plus'
  | 'x'
  | 'check'
  | 'copy'
  | 'trash'
  | 'settings'
  | 'eye'
  | 'eye-off'
  | 'alert-triangle'
  | 'circle-dot'
  | 'terminal'
  | 'folder'
  | 'file-code'
  | 'wrench'
  | 'list-checks'
  | 'cpu'
  | 'key'
  | 'activity'
  | 'coins'
  | 'image'
  | 'play'
  | 'square'
  | 'download'
  | 'upload'
  | 'globe'
  | 'refresh'
  | 'clock'
  | 'spark'
  | 'user'
  | 'message'
  | 'branch'
  | 'info'
  | 'panel';

const P: Record<IconName, ReactNode> = {
  'chevron-down': <path d="M4 6.5 8 10.5 12 6.5" />,
  'chevron-right': <path d="M6.5 4 10.5 8 6.5 12" />,
  'chevron-up': <path d="M4 9.5 8 5.5 12 9.5" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  x: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  check: <path d="M3 8.5 6.2 11.7 13 4.9" />,
  copy: (
    <>
      <path d="M5.5 3.5h7v7" />
      <path d="M3.5 5.5v7h7" />
    </>
  ),
  trash: (
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5M6.5 7v4M9.5 7v4" />
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" />
    </>
  ),
  eye: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.9" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  'alert-triangle': (
    <>
      <path d="M8 2.2 1.8 13.2h12.4z" />
      <path d="M8 6.4v3.2M8 11.4h.01" />
    </>
  ),
  'circle-dot': (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  terminal: <path d="M3 2.5v11M3 2.5h6.5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3M5.8 6 7.6 8l-1.8 2" />,
  folder: (
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3L8 4.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
  ),
  'file-code': (
    <>
      <path d="M5 1.8H3.5A1.5 1.5 0 0 0 2 3.3v9.4A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V3.3A1.5 1.5 0 0 0 12.5 1.8H11" />
      <path d="M8 1.8v4M6 3.8h4" />
    </>
  ),
  wrench: (
    <path d="M10.8 2.2a3.1 3.1 0 0 0-2.9 4.2L2.3 11.9a1.4 1.4 0 0 0 2 2l5.5-5.6a3.1 3.1 0 0 0 4.2-2.9l-2 2-1.9-1.9z" />
  ),
  'list-checks': <path d="M2.5 4.5h2v2h-2zM2.5 9.5h2v2h-2zM7 5.5h7M7 10.5h7" />,
  cpu: <path d="M5 2.5v3M11 2.5v3M3.5 5.5h9v5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 10.5z" />,
  key: <path d="M4 7V5a4 4 0 0 1 8 0v2M3 7h10v7H3z" />,
  activity: <path d="M1.5 8h3l2-5 3 10 2-5h3" />,
  coins: (
    <>
      <path d="M8 2.5c3 0 5.5 1 5.5 2.2S11 7 8 7 2.5 6 2.5 4.7 5 2.5 8 2.5z" />
      <path d="M2.5 4.7v6.6c0 1.2 2.5 2.2 5.5 2.2s5.5-1 5.5-2.2V4.7" />
    </>
  ),
  image: (
    <>
      <path d="M2.5 3.5h11v9h-11z" />
      <path d="M2.5 10 6 7l3 2.5L11 8l2.5 2.5" />
      <circle cx="5.5" cy="6" r="0.9" />
    </>
  ),
  play: <path d="M5 3.5 12 8l-7 4.5z" />,
  square: <path d="M4 4h8v8H4z" />,
  download: <path d="M8 2v8M5 7l3 3 3-3M3 12.5h10" />,
  upload: <path d="M8 11V3M5 6l3-3 3 3M3 12.5h10" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c1.7 1.9 2.6 3.9 2.6 6.2S9.7 12.3 8 14.2C6.3 12.3 5.4 10.3 5.4 8S6.3 3.7 8 1.8z" />
    </>
  ),
  refresh: <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2v3.5H10" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  spark: <path d="M8 1.8l1.5 3.7 3.7 1.5-3.7 1.5L8 12.2 6.5 8.5 2.8 7l3.7-1.5z" />,
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5a5 5 0 0 1 10 0" />
    </>
  ),
  message: <path d="M2.5 3.5h11v8h-6l-3 2.5v-2.5h-2z" />,
  branch: (
    <>
      <circle cx="4.5" cy="4" r="1.8" />
      <circle cx="4.5" cy="12" r="1.8" />
      <circle cx="11.5" cy="6.5" r="1.8" />
      <path d="M4.5 5.8v4.4M11.5 8.3c0 2-2 2.2-3.6 2.6" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.2v4M8 4.9h.01" />
    </>
  ),
  panel: <path d="M2.5 3.5h11v9h-11zM6.5 3.5v9" />,
};

export interface IconProps {
  name: IconName;
  /** 'sm' = 13px, 'lg' = 20px, 'md' = 16px (varsayılan) */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
}

export function Icon({ name, size = 'md', className, title }: IconProps) {
  const cls = size === 'md' ? 'icon' : `icon icon-${size}`;
  return (
    <svg
      className={className ? `${cls} ${className}` : cls}
      viewBox="0 0 16 16"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {P[name]}
    </svg>
  );
}

/** Model/araç yetenek rozetleri için ikon eşlemesi. */
export const CAP_ICON = {
  tools: 'wrench',
  vision: 'eye',
  reasoning: 'spark',
} as const;
