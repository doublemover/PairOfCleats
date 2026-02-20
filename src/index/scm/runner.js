import { spawnSubprocess } from '../../shared/subprocess.js';

const defaultRunner = (command, args, options = {}) => (
  spawnSubprocess(command, args, { ...options, shell: false })
);

const DEFAULT_SCM_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

let activeRunner = defaultRunner;

export const setScmCommandRunner = (runner) => {
  activeRunner = typeof runner === 'function' ? runner : defaultRunner;
};

export const getScmCommandRunner = () => activeRunner;

const withScmRunnerDefaults = (options = {}) => ({
  ...options,
  // SCM commands are short-lived leaf processes (git/jj). On Windows, forcing
  // tree kills on timeout can block in synchronous taskkill calls and turn
  // sub-second timeouts into multi-second stalls. Keep killTree opt-in.
  killTree: typeof options.killTree === 'boolean' ? options.killTree : false,
  // File-list operations can legitimately exceed 1MB on large repos; avoid
  // silent truncation that drops tracked paths from discovery.
  maxOutputBytes: Number.isFinite(Number(options.maxOutputBytes)) && Number(options.maxOutputBytes) > 0
    ? Math.floor(Number(options.maxOutputBytes))
    : DEFAULT_SCM_MAX_OUTPUT_BYTES
});

export const runScmCommand = (command, args, options = {}) => (
  activeRunner(command, args, withScmRunnerDefaults(options))
);
