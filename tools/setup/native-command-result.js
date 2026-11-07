import { spawnResolvedSubprocess } from '../../src/shared/subprocess/command-invocation.js';
import { describeStorageFailure } from '../../src/shared/storage/failure-observation.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { formatSpawnFailureReason } from './rebuild-native-exit.js';
import { isNativeDiagnosticFailure } from './native-diagnostics.js';

/** Diagnostic projection only, after the original subprocess owner confirms
 * retirement. Pending/unknown child ownership escapes unchanged in its original
 * observation graph; it cannot authorize a rebuild fallback or another probe.
 */
export const settledNativeSetupFailure = (error, phase) => {
  if (isNativeDiagnosticFailure(error)) throw error;
  const description = describeStorageFailure(error, { phase, defaultCode: 'ERR_NATIVE_SETUP_COMMAND',
    defaultMessage: 'Native setup command failed; inspect its original failure.' });
  if (readErrorDataProperty(error, 'name') === 'AbortError' || readErrorDataProperty(error, 'code') === 'ABORT_ERR') throw error;
  const result = readErrorDataProperty(error, 'result');
  const diagnostics = readErrorDataProperty(error, 'diagnostics'), diagnosticsPath = readErrorDataProperty(error, 'diagnosticsPath');
  const logs = readErrorDataProperty(diagnostics, 'logs');
  const logTail = channel => {
    for (const index of ['0', '1']) {
      const log = readErrorDataProperty(logs, index);
      if (readErrorDataProperty(log, 'channel') === channel) return readErrorDataProperty(log, 'tail');
    }
    return undefined;
  };
  const stdout = readErrorDataProperty(result, 'stdout') ?? logTail('stdout'),
    stderr = readErrorDataProperty(result, 'stderr') ?? logTail('stderr');
  return { ok: false, error, message: description.message + (typeof diagnosticsPath === 'string' ? '; log: ' + diagnosticsPath : ''), code: description.code,
    ...(result ? { result } : {}), ...(diagnostics ? { diagnostics } : {}),
    ...(typeof diagnosticsPath === 'string' ? { diagnosticsPath } : {}),
    ...(typeof stdout === 'string' ? { stdout } : {}), ...(typeof stderr === 'string' ? { stderr } : {}) };
};

export const runNativeSetupCommand = async (command, args, options, { spawn = spawnResolvedSubprocess, diagnostics = null, observeOutput = null } = {}) => {
  let result;
  try { result = diagnostics ? await diagnostics.run(command, args, options, spawn, { onOutput: observeOutput }) : await spawn(command, args, options); }
  catch (error) { return settledNativeSetupFailure(error, 'native-setup-command'); }
  const stdoutTruncated = result.outputCapture?.stdout?.truncated === true, stderrTruncated = result.outputCapture?.stderr?.truncated === true;
  if (stdoutTruncated || stderrTruncated) {
    // Compiler success is still compiler success. Incomplete evidence is a
    // separate terminal failure, not a reason to retry the native operation.
    throw Object.assign(new Error('Native command settled but its transcript exceeded the bounded capture; compiler status is retained separately.'), {
      code: 'ERR_NATIVE_SETUP_TRANSCRIPT_LIMIT', result: { ...result, compilerStatus: result.exitCode === 0 ? 'succeeded' : 'failed',
        diagnostics: { complete: false, stdoutTruncated, stderrTruncated } }
    });
  }
  return { ok: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr,
    ...(result.diagnostics ? { diagnostics: result.diagnostics, diagnosticsPath: result.diagnosticsPath } : {}),
    message: result.exitCode === 0 ? null : formatSpawnFailureReason({ status: result.exitCode, signal: result.signal })
      + (result.diagnosticsPath ? '; log: ' + result.diagnosticsPath : '') };
};
