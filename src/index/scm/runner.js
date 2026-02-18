import { spawnSubprocess } from '../../shared/subprocess.js';

const defaultRunner = (command, args, options = {}) => (
  spawnSubprocess(command, args, { ...options, shell: false })
);

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
  killTree: typeof options.killTree === 'boolean' ? options.killTree : false
});

export const runScmCommand = (command, args, options = {}) => (
  activeRunner(command, args, withScmRunnerDefaults(options))
);
