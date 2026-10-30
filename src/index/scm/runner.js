import { spawnSubprocess } from '../../shared/subprocess/runner.js';
import { withSchedulerCpuSuspended } from '../../shared/concurrency/scheduler-task-scope.js';

const defaultRunner = (command, args, options = {}) => {
  // Launch under the caller's compute admission. Buffered commands only wait
  // after launch; provider parsing resumes after compute reacquisition. Hooks
  // can do arbitrary JS work while the child runs, so retain their permit.
  const pending = spawnSubprocess(command, args, { ...options, shell: false });
  if (['onSpawn', 'onStdout', 'onStderr'].some(name => typeof options[name] === 'function')) return pending;
  return withSchedulerCpuSuspended(() => pending);
};

const DEFAULT_SCM_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

let activeRunner = defaultRunner;

/**
 * Override SCM command execution for tests or alternate backends.
 *
 * @param {(command:string,args:Array<string>,options?:object)=>Promise<object>|object} runner
 * @returns {void}
 */
export const setScmCommandRunner = (runner) => {
  activeRunner = typeof runner === 'function' ? runner : defaultRunner;
};

/**
 * Get the currently active SCM runner implementation.
 *
 * @returns {(command:string,args:Array<string>,options?:object)=>Promise<object>|object}
 */
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

/**
 * Execute an SCM command with repo-safe defaults.
 *
 * @param {string} command
 * @param {Array<string>} args
 * @param {object} [options]
 * @returns {Promise<object>|object}
 */
export const runScmCommand = (command, args, options = {}) => (
  activeRunner(command, args, withScmRunnerDefaults(options))
);
