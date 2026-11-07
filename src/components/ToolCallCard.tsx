import { useState } from 'react';
import type { ToolEvent } from '../types';
import { useT } from '../lib/i18n';
import { cancelExec } from '../lib/engine/tools/shell';
import { Icon, type IconName } from './icons';

interface Props {
  tool: ToolEvent;
}

/** Araç adı → ikon eşlemesi. */
const TOOL_ICON: Record<string, IconName> = {
  read_file: 'file-code',
  write_file: 'file-code',
  edit_file: 'file-code',
  apply_patch: 'wrench',
  propose_patch: 'wrench',
  exec: 'terminal',
  grep_files: 'search',
  glob_files: 'folder',
  list_dir: 'folder',
  todo: 'list-checks',
  plan: 'list-checks',
  subagent: 'cpu',
  web_search: 'globe',
  skill: 'spark',
};

export function toolIcon(name: string): IconName {
  return TOOL_ICON[name] ?? 'wrench';
}

export default function ToolCallCard({ tool }: Props) {
  const t = useT();
  // P0.2: çalışan exec otomatik açılır → canlı çıktı görünür olur.
  const [open, setOpen] = useState(() => tool.name === 'exec' && tool.status === 'run');
  const hasOutput = !!tool.output && tool.output.trim().length > 0;
  const failed = tool.status === 'err';
  const running = tool.status === 'run';
  const canCancel = running && tool.name === 'exec';
  const statusLabel = running ? t('tool.running') : failed ? t('tool.failed') : t('tool.done');

  return (
    <div className={`tool${failed ? ' tool-failed' : ''}`}>
      <div className="tool-head">
        <button
          className="tool-toggle"
          onClick={() => hasOutput && setOpen((v) => !v)}
          aria-expanded={hasOutput ? open : undefined}
          aria-label={`${tool.name} — ${statusLabel}`}
        >
          <span className="tool-ico">
            <Icon name={toolIcon(tool.name)} size="sm" />
          </span>
          <span className="tool-name">{tool.name}</span>
          {tool.args ? <span className="tool-arg">{tool.args}</span> : null}
          {tool.ms !== undefined ? <span className="tool-dur">{tool.ms}ms</span> : null}
          <span
            className={`tool-status${running ? ' run' : failed ? ' err' : ' ok'}`}
            title={statusLabel}
          >
            <Icon name={running ? 'activity' : failed ? 'x' : 'check'} size="sm" />
          </span>
          {hasOutput ? (
            <Icon name="chevron-down" size="sm" className="tool-chev" />
          ) : null}
        </button>
        {canCancel ? (
          <button
            className="tool-stop"
            onClick={() => void cancelExec(tool.id)}
            title={t('common.cancel')}
            aria-label={t('common.cancel')}
          >
            <Icon name="x" size="sm" />
          </button>
        ) : null}
      </div>
      {hasOutput && open ? (
        <pre className="tool-out">{tool.output}</pre>
      ) : null}
    </div>
  );
}
