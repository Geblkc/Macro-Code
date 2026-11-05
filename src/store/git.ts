/**
 * Git paneli durumu — Zustand.
 *
 * Yalnızca görünüm tercihleri (open/width/tab) persist edilir; repo verisi
 * (yol, branch, diff) localStorage'a yazılmaz. Her async istek bir nesil
 * sayacıyla korunur: eski yanıtlar yeni state'i ezmez.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { gitApi } from '../lib/git/api';
import { asGitError } from '../lib/git/errors';
import type {
  GitBranch,
  GitCommit,
  GitDiff,
  GitError,
  GitRemote,
  GitRepoInfo,
  GitStatus,
  GitTab,
} from '../lib/git/types';
import { useWorkspaceStore } from './workspace';

export const GIT_MIN_WIDTH = 280;
export const GIT_MAX_WIDTH = 560;
export const GIT_DEFAULT_WIDTH = 340;

export function clampGitWidth(px: number): number {
  if (!Number.isFinite(px)) return GIT_DEFAULT_WIDTH;
  return Math.min(GIT_MAX_WIDTH, Math.max(GIT_MIN_WIDTH, Math.round(px)));
}

interface GitStore {
  open: boolean;
  width: number;
  tab: GitTab;

  info: GitRepoInfo | null;
  status: GitStatus | null;
  branches: GitBranch[];
  remotes: GitRemote[];
  log: GitCommit[];
  diff: GitDiff | null;
  selected: { path: string; staged: boolean } | null;
  loading: boolean;
  error: GitError | null;
  /** Refresh'in hangi workspace için yapıldığı (root değişimini yakalar). */
  lastRoot: string;

  setOpen: (v: boolean) => void;
  toggle: () => void;
  setWidth: (px: number) => void;
  setTab: (tab: GitTab) => void;
  reset: () => void;

  refresh: (root?: string) => Promise<void>;
  loadLog: (more?: boolean) => Promise<void>;
  selectFile: (path: string, staged: boolean) => Promise<void>;
  clearSelection: () => void;

  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: (message: string, amend?: boolean) => Promise<GitCommit>;
  switchBranch: (name: string, create?: boolean) => Promise<void>;
  fetch: () => Promise<void>;
  pull: () => Promise<void>;
  push: (setUpstream?: boolean) => Promise<void>;
  init: () => Promise<void>;
}

const noopStorage = {
  getItem: (_name: string): string | null => null,
  setItem: (_name: string, _value: string): void => {},
  removeItem: (_name: string): void => {},
};

/** Eski async yanıtları geçersiz kılan nesil sayacı. */
let generation = 0;

/** Rust `MAX_PATHS` (500) altında kalacak şekilde yol paketleri. */
const PATH_CHUNK = 400;

function rootOf(): string {
  return useWorkspaceStore.getState().root;
}

/** Çok sayıda yolu Rust'ın tek çağrı sınırına sığacak biçimde böler. */
async function runChunked(
  paths: string[],
  fn: (chunk: string[]) => Promise<GitStatus>,
): Promise<GitStatus> {
  let last: GitStatus | null = null;
  for (let i = 0; i < paths.length; i += PATH_CHUNK) {
    last = await fn(paths.slice(i, i + PATH_CHUNK));
  }
  // paths boş değil (çağıranlar kontrol eder); tip daraltması için.
  return last as GitStatus;
}

export const useGitStore = create<GitStore>()(
  persist(
    (set, get) => {
      const applyError = (e: unknown): GitError => {
        const err = asGitError(e);
        set({ error: err, loading: false });
        return err;
      };

      const applyStatus = (status: GitStatus) => {
        set((s) => ({
          status,
          info: s.info
            ? {
                ...s.info,
                branch: status.branch,
                detached: status.detached,
                head: status.head,
                upstream: status.upstream,
                ahead: status.ahead,
                behind: status.behind,
                operation: status.operation,
              }
            : s.info,
        }));
      };

      /** Seçili dosya etkilendiyse diff'i kapat (stale içerik gösterme). */
      const clearForPaths = (paths: string[]) => {
        const cur = get().selected;
        if (cur && paths.includes(cur.path)) {
          set({ diff: null, selected: null });
        }
      };

      const run = async <T>(fn: () => Promise<T>): Promise<T> => {
        set({ loading: true, error: null });
        try {
          return await fn();
        } catch (e) {
          throw applyError(e);
        } finally {
          set({ loading: false });
        }
      };

      return {
        open: false,
        width: GIT_DEFAULT_WIDTH,
        tab: 'changes',

        info: null,
        status: null,
        branches: [],
        remotes: [],
        log: [],
        diff: null,
        selected: null,
        loading: false,
        error: null,
        lastRoot: '',

        setOpen: (open) => set({ open }),
        toggle: () => set((s) => ({ open: !s.open })),
        setWidth: (px) => set({ width: clampGitWidth(px) }),
        setTab: (tab) => {
          set({ tab });
          if (tab === 'history' && get().log.length === 0 && get().status) {
            void get().loadLog();
          }
        },

        reset: () => {
          generation += 1;
          set({
            info: null,
            status: null,
            branches: [],
            remotes: [],
            log: [],
            diff: null,
            selected: null,
            loading: false,
            error: null,
            lastRoot: '',
          });
        },

        refresh: async (rootArg) => {
          const root = rootArg ?? rootOf();
          const gen = ++generation;
          if (!root) {
            set({
              info: null,
              status: null,
              branches: [],
              remotes: [],
              log: [],
              diff: null,
              selected: null,
              loading: false,
              error: null,
              lastRoot: '',
            });
            return;
          }
          if (get().lastRoot !== root) {
            set({
              info: null,
              status: null,
              branches: [],
              remotes: [],
              log: [],
              diff: null,
              selected: null,
              error: null,
              lastRoot: root,
            });
          }
          set({ loading: true, error: null });
          try {
            const info = await gitApi.detect(root);
            if (gen !== generation) return;
            if (!info.isRepo) {
              set({ info, status: null, branches: [], remotes: [], log: [], loading: false });
              return;
            }
            const status = await gitApi.status(root);
            if (gen !== generation) return;
            const [branches, remotes] = await Promise.all([
              gitApi.branches(root).catch(() => [] as GitBranch[]),
              gitApi.remotes(root).catch(() => [] as GitRemote[]),
            ]);
            if (gen !== generation) return;
            set({ info, status, branches, remotes, loading: false, error: null });
            if (get().tab === 'history') {
              await get().loadLog();
            }
          } catch (e) {
            if (gen === generation) applyError(e);
          }
        },

        loadLog: async (more) => {
          const root = rootOf();
          if (!root) return;
          const gen = generation;
          const skip = more ? get().log.length : 0;
          try {
            const commits = await gitApi.log(root, 30, skip);
            if (gen !== generation) return;
            set((s) => ({
              log: more ? [...s.log, ...commits] : commits,
            }));
          } catch {
            // Log yükleme hatası panelin ana durumunu bozmaz.
          }
        },

        selectFile: async (path, staged) => {
          const root = rootOf();
          if (!root) return;
          set({ selected: { path, staged } });
          const stillCurrent = () => {
            const cur = get().selected;
            return (
              rootOf() === root &&
              cur?.path === path &&
              cur?.staged === staged
            );
          };
          try {
            const diff = await gitApi.diff(root, path, staged);
            if (stillCurrent()) set({ diff });
          } catch (e) {
            const err = applyError(e);
            if (stillCurrent()) set({ diff: null });
            throw err;
          }
        },

        clearSelection: () => set({ diff: null, selected: null }),

        stage: async (paths) => {
          if (paths.length === 0) return;
          const root = rootOf();
          const status = await run(() => runChunked(paths, (c) => gitApi.stage(root, c)));
          applyStatus(status);
          clearForPaths(paths);
        },

        unstage: async (paths) => {
          if (paths.length === 0) return;
          const root = rootOf();
          const status = await run(() => runChunked(paths, (c) => gitApi.unstage(root, c)));
          applyStatus(status);
          clearForPaths(paths);
        },

        discard: async (paths) => {
          if (paths.length === 0) return;
          const root = rootOf();
          const status = await run(() => runChunked(paths, (c) => gitApi.discard(root, c)));
          applyStatus(status);
          set({ diff: null, selected: null });
        },

        commit: async (message, amend) => {
          const root = rootOf();
          const commit = await run(() => gitApi.commit(root, message, amend));
          set({ diff: null, selected: null });
          await get().refresh(root);
          return commit;
        },

        switchBranch: async (name, create) => {
          const root = rootOf();
          const status = await run(() => gitApi.switchBranch(root, name, create));
          applyStatus(status);
          set({ diff: null, selected: null });
          await get().refresh(root);
        },

        fetch: async () => {
          const root = rootOf();
          const status = await run(() => gitApi.fetch(root));
          applyStatus(status);
        },

        pull: async () => {
          const root = rootOf();
          const status = await run(() => gitApi.pull(root));
          applyStatus(status);
          await get().refresh(root);
        },

        push: async (setUpstream) => {
          const root = rootOf();
          const status = await run(() => gitApi.push(root, setUpstream));
          applyStatus(status);
        },

        init: async () => {
          const root = rootOf();
          await run(() => gitApi.init(root));
          await get().refresh(root);
        },
      };
    },
    {
      name: 'macrocode-git',
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : noopStorage,
      ),
      partialize: (s) => ({ open: s.open, width: s.width, tab: s.tab }),
    },
  ),
);
