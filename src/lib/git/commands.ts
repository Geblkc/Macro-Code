/**
 * `/git` slash komutları — parser + çalıştırıcı.
 *
 * Tüm işlemler `GitApi` üzerinden gider (testte fake enjekte edilir). Mutation
 * komutları App'in genel `ConfirmDialog`'unu kullanır; hook uyarısı metinde
 * açıkça belirtilir.
 */
import type { CommandLine } from '../commands';
import { t } from '../i18n/core';
import type { TranslationKey } from '../i18n/core';
import { asGitError } from './errors';
import type { GitApi } from './api';
import type { GitRepoInfo, GitStatus } from './types';

export interface GitConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  initialFocus?: 'confirm' | 'cancel';
}

export interface GitCommandContext {
  root: string;
  api: GitApi;
  push: (line: CommandLine) => void;
  /** Panel'i açar (commit kutusuna odaklanması için). */
  openPanel: () => void;
  confirm: (req: GitConfirmRequest) => Promise<boolean>;
}

/** Tırnak desteğiyle basit argüman ayrıştırıcı. */
export function parseArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  return out;
}

function branchLine(st: GitStatus): string {
  const ab =
    st.ahead > 0 || st.behind > 0 ? ` ↑${st.ahead} ↓${st.behind}` : '';
  const up = st.upstream ? ` → ${st.upstream}` : '';
  const det = st.detached ? ` (${t('git.detached')})` : '';
  return `${st.branch || 'HEAD'}${det}${up}${ab}`;
}

function summaryLines(st: GitStatus): CommandLine[] {
  const lines: CommandLine[] = [
    { type: 'sys', content: `/// git: ${branchLine(st)}` },
  ];
  if (st.files.length === 0) {
    lines.push({ type: 'sys', content: t('git.clean') });
    return lines;
  }
  for (const f of st.files.slice(0, 40)) {
    const mark = f.staged ? '●' : '○';
    lines.push({
      type: 'sys',
      content: `  ${mark} ${f.indexStatus}${f.worktreeStatus} ${f.path}`,
    });
  }
  if (st.files.length > 40) {
    lines.push({
      type: 'warn',
      content: t('git.moreFiles', { count: st.files.length - 40 }),
    });
  }
  return lines;
}

function repoProblem(info: GitRepoInfo): CommandLine | null {
  if (!info.installed) return { type: 'err', content: t('git.error.gitMissing') };
  if (info.bare) return { type: 'err', content: t('git.error.bareRepo') };
  if (info.outsideRepo) return { type: 'err', content: t('git.error.outsideRepo') };
  if (!info.isRepo) return { type: 'warn', content: t('git.notRepoHint') };
  return null;
}

async function detect(ctx: GitCommandContext): Promise<GitRepoInfo | null> {
  if (!ctx.root) {
    ctx.push({ type: 'err', content: t('commands.git.noWorkspace') });
    return null;
  }
  try {
    const info = await ctx.api.detect(ctx.root);
    const problem = repoProblem(info);
    if (problem) {
      ctx.push(problem);
      return null;
    }
    return info;
  } catch (e) {
    const err = asGitError(e);
    ctx.push({ type: 'err', content: `${t('git.error.failed')}: ${err.message}` });
    return null;
  }
}

async function withError(
  ctx: GitCommandContext,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const err = asGitError(e);
    ctx.push({ type: 'err', content: `${t('git.error.failed')}: ${err.message}` });
  }
}

/**
 * `/git ...` komutunu işler. `/git` ile başlamıyorsa `false` döner (App
 * generic `handleSlashCommand`'a düşer).
 */
export async function runGitCommand(
  raw: string,
  ctx: GitCommandContext,
): Promise<boolean> {
  const trimmed = raw.trim();
  if (trimmed !== '/git' && !trimmed.startsWith('/git ')) return false;

  const rest = trimmed.slice(4).trim();
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest);
  const sub = (m?.[1] ?? 'status').toLowerCase();
  const tail = (m?.[2] ?? '').trim();

  // Yardım workspace gerektirmez.
  if (sub === 'help' || sub === '?') {
    for (const line of gitHelpLines()) ctx.push(line);
    return true;
  }

  if (!(await detect(ctx))) return true;

  switch (sub) {
    case 'status': {
      await withError(ctx, async () => {
        const st = await ctx.api.status(ctx.root);
        for (const line of summaryLines(st)) ctx.push(line);
      });
      return true;
    }

    case 'diff': {
      await withError(ctx, async () => {
        const args = parseArgs(tail);
        const staged = args.includes('--staged') || args.includes('--cached');
        const path = args.find((a) => !a.startsWith('-')) ?? null;
        const diff = await ctx.api.diff(ctx.root, path, staged);
        if (!diff.text.trim()) {
          ctx.push({ type: 'sys', content: t('git.diff.noChanges') });
          return;
        }
        const lines = diff.text.split('\n');
        const cap = 200;
        for (const line of lines.slice(0, cap)) {
          ctx.push({ type: 'sys', content: line });
        }
        if (lines.length > cap || diff.truncated) {
          ctx.push({ type: 'warn', content: t('git.diff.truncated') });
        }
      });
      return true;
    }

    case 'log': {
      const n = Math.min(Math.max(parseInt(tail, 10) || 10, 1), 50);
      await withError(ctx, async () => {
        const commits = await ctx.api.log(ctx.root, n);
        if (commits.length === 0) {
          ctx.push({ type: 'sys', content: t('git.log.empty') });
          return;
        }
        for (const c of commits) {
          const date = new Date(c.timestamp * 1000);
          const stamp = Number.isNaN(date.getTime())
            ? ''
            : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          ctx.push({
            type: 'sys',
            content: `  ${c.short}  ${stamp}  ${c.subject}  — ${c.author}`,
          });
        }
      });
      return true;
    }

    case 'branch': {
      await withError(ctx, async () => {
        const branches = await ctx.api.branches(ctx.root);
        const local = branches.filter((b) => !b.remote);
        if (local.length === 0) {
          ctx.push({ type: 'sys', content: t('git.branch.empty') });
          return;
        }
        for (const b of local) {
          ctx.push({
            type: 'sys',
            content: `  ${b.current ? '*' : ' '} ${b.name}${b.upstream ? ` → ${b.upstream}` : ''}`,
          });
        }
      });
      return true;
    }

    case 'switch':
    case 'checkout': {
      const args = parseArgs(tail);
      const create = args[0] === '-c' || args[0] === '-b';
      const name = create ? args[1] : args[0];
      if (!name) {
        ctx.push({ type: 'err', content: t('git.branch.usage') });
        return true;
      }
      const ok = await ctx.confirm({
        title: create ? t('git.branch.create') : t('git.branch.switch'),
        message: create
          ? t('git.branch.createConfirm', { name })
          : t('git.branch.switchConfirm', { name }),
        confirmLabel: t('common.apply'),
        cancelLabel: t('common.cancel'),
        initialFocus: 'cancel',
      });
      if (!ok) return true;
      await withError(ctx, async () => {
        const st = await ctx.api.switchBranch(ctx.root, name, create);
        ctx.push({ type: 'sys', content: `/// git: ${branchLine(st)}` });
      });
      return true;
    }

    case 'add':
    case 'stage': {
      const paths = parseArgs(tail);
      if (paths.length === 0) {
        ctx.push({ type: 'err', content: t('git.stageUsage') });
        return true;
      }
      await withError(ctx, async () => {
        await ctx.api.stage(ctx.root, paths);
        ctx.push({ type: 'sys', content: t('git.stagedDone', { count: paths.length }) });
      });
      return true;
    }

    case 'unstage': {
      const paths = parseArgs(tail);
      if (paths.length === 0) {
        ctx.push({ type: 'err', content: t('git.unstageUsage') });
        return true;
      }
      await withError(ctx, async () => {
        await ctx.api.unstage(ctx.root, paths);
        ctx.push({ type: 'sys', content: t('git.unstagedDone', { count: paths.length }) });
      });
      return true;
    }

    case 'commit': {
      if (!tail || tail === '--ai') {
        ctx.openPanel();
        ctx.push({
          type: 'sys',
          content: tail === '--ai' ? t('git.ai.panelHint') : t('git.commitPanelHint'),
        });
        return true;
      }
      let amend = false;
      let message = tail;
      if (tail === '--amend') {
        // Mesajsız amend: son commit mesajını yeniden kullan.
        amend = true;
        const commits = await ctx.api.log(ctx.root, 1).catch(() => []);
        if (commits.length === 0) {
          ctx.push({ type: 'err', content: t('git.error.nothingStaged') });
          return true;
        }
        message = commits[0].body
          ? `${commits[0].subject}\n\n${commits[0].body}`
          : commits[0].subject;
      } else if (tail.startsWith('--amend ')) {
        amend = true;
        message = tail.slice(8).trim();
      }
      if (!message) {
        ctx.openPanel();
        ctx.push({ type: 'sys', content: t('git.commitPanelHint') });
        return true;
      }
      const ok = await ctx.confirm({
        title: t('git.commit'),
        message: `${t('git.hooksWarning')}\n\n${message}`,
        confirmLabel: t('git.commit'),
        cancelLabel: t('common.cancel'),
        danger: amend,
        initialFocus: 'cancel',
      });
      if (!ok) return true;
      await withError(ctx, async () => {
        const c = await ctx.api.commit(ctx.root, message, amend);
        ctx.push({
          type: 'sys',
          content: t('git.commitDone', { sha: c.short || c.sha.slice(0, 7), subject: c.subject }),
        });
      });
      return true;
    }

    case 'fetch':
    case 'pull':
    case 'push': {
      if (sub !== 'fetch') {
        const ok = await ctx.confirm({
          title: sub === 'push' ? t('git.push') : t('git.pull'),
          message: sub === 'push' ? t('git.pushConfirm') : t('git.pullConfirm'),
          confirmLabel: sub === 'push' ? t('git.push') : t('git.pull'),
          cancelLabel: t('common.cancel'),
          initialFocus: 'cancel',
        });
        if (!ok) return true;
      }
      await withError(ctx, async () => {
        const st =
          sub === 'fetch'
            ? await ctx.api.fetch(ctx.root)
            : sub === 'pull'
              ? await ctx.api.pull(ctx.root)
              : await ctx.api.push(ctx.root);
        ctx.push({ type: 'sys', content: `/// git: ${branchLine(st)}` });
      });
      return true;
    }

    case 'init': {
      const ok = await ctx.confirm({
        title: t('git.init'),
        message: t('git.initConfirm'),
        confirmLabel: t('git.init'),
        cancelLabel: t('common.cancel'),
        initialFocus: 'cancel',
      });
      if (!ok) return true;
      await withError(ctx, async () => {
        await ctx.api.init(ctx.root);
        ctx.push({ type: 'sys', content: t('git.initDone') });
      });
      return true;
    }

    default:
      ctx.push({
        type: 'err',
        content: t('commands.git.unknown', { sub }),
      });
      return true;
  }
}

/** `/git help` ve `/help` içinde kullanılan alt komut listesi. */
export function gitHelpLines(): CommandLine[] {
  const items: Array<[string, TranslationKey]> = [
    ['/git status', 'git.help.status'],
    ['/git diff [--staged]', 'git.help.diff'],
    ['/git log [n]', 'git.help.log'],
    ['/git branch', 'git.help.branch'],
    ['/git switch [-c] <name>', 'git.help.switch'],
    ['/git add <path...>', 'git.help.add'],
    ['/git unstage <path...>', 'git.help.unstage'],
    ['/git commit [msg]', 'git.help.commit'],
    ['/git push|pull|fetch', 'git.help.remote'],
    ['/git init', 'git.help.init'],
  ];
  const lines: CommandLine[] = [
    { type: 'sys', content: t('commands.help.gitSubcommands') },
  ];
  for (const [cmd, key] of items) {
    lines.push({ type: 'sys', content: `  ${cmd.padEnd(26)} · ${t(key)}` });
  }
  return lines;
}
