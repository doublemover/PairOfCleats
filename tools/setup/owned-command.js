// Source and focused regressions are UNVALIDATED in this development batch.
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';

/** Guided setup stays responsive while its existing subprocess owner manages
 * actual child close and termination. Never flatten a pending owner error into
 * an ordinary failed step that permits the next acquisition/build to start.
 */
export const runSetupCommand = async (command, args, options = {}, { spawn = spawnResolvedSubprocess } = {}) => {
  const { encoding, maxBuffer, ...childOptions } = options;
  options.signal?.throwIfAborted();
  const result = await spawn(command, Array.isArray(args) ? args : [], { ...childOptions,
    outputEncoding: options.outputEncoding || encoding || 'utf8',
    maxOutputBytes: options.maxOutputBytes ?? maxBuffer ?? 1024 * 1024,
    captureStdout: options.captureStdout !== false, captureStderr: options.captureStderr !== false,
    outputMode: 'string', rejectOnNonZeroExit: false });
  options.signal?.throwIfAborted();
  return { ok: result.exitCode === 0, status: result.exitCode ?? null,
    signal: typeof result.signal === 'string' ? result.signal : null,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '' };
};
