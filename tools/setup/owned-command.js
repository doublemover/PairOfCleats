// Source and focused regressions are UNVALIDATED in this development batch.
import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';

/** Guided setup stays responsive while its existing subprocess owner manages
 * actual child close and termination. Never flatten a pending owner error into
 * an ordinary failed step that permits the next acquisition/build to start.
 */
export const runSetupCommand = async (command, args, options = {}, { spawn = spawnResolvedSubprocess, diagnostics = null } = {}) => {
  const { encoding, maxBuffer, ...childOptions } = options;
  options.signal?.throwIfAborted();
  const selectedOptions = { ...childOptions,
    outputEncoding: options.outputEncoding || encoding || 'utf8',
    maxOutputBytes: options.maxOutputBytes ?? maxBuffer ?? 1024 * 1024,
    captureStdout: options.captureStdout !== false, captureStderr: options.captureStderr !== false,
    outputMode: 'string', rejectOnNonZeroExit: false };
  let result;
  try {
    result = diagnostics ? await diagnostics.run(command, Array.isArray(args) ? args : [], selectedOptions, spawn)
      : await spawn(command, Array.isArray(args) ? args : [], selectedOptions);
  } catch (error) {
    const childResult = readErrorDataProperty(error, 'result');
    throw childResult ? addStorageFailureContext(error, { childResult }, null, { nonEnumerable: ['childResult'] }) : error;
  }
  try { options.signal?.throwIfAborted(); }
  catch (error) { throw addStorageFailureContext(error, { childResult: result, diagnosticsPath: result.diagnosticsPath }, null, { nonEnumerable: ['childResult'] }); }
  return { ok: result.exitCode === 0, status: result.exitCode ?? null,
    signal: typeof result.signal === 'string' ? result.signal : null,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    ...(result.diagnostics ? { diagnostics: result.diagnostics, diagnosticsPath: result.diagnosticsPath } : {}) };
};
