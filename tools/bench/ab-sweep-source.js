import { spawnSubprocessSync } from '../../src/shared/subprocess/runner.js';
import { observeStorageResource } from '../../src/shared/storage/failure-observation.js';

/** Boundary source witness, not a dependency/native runtime qualification.
 * Ignored experiment outputs do not make an otherwise clean checkout dirty. */
export const captureSweepSource = (root, { execute = spawnSubprocessSync, diagnostics = null } = {}) => {
  const record = observation => {
    if (Array.isArray(diagnostics) && diagnostics.length < 3) diagnostics.push(observation);
  };
  const data = (value, key) => {
    try { return value && Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
  };
  try {
    const run = args => {
      const result = execute('git', ['-C', root, ...args], { cwd: root,
        timeoutMs: 5000, maxOutputBytes: 64 * 1024, captureStdout: true, captureStderr: true,
        outputMode: 'string', rejectOnNonZeroExit: false });
      record({ command: 'git', args: ['-C', root, ...args], result });
      const capture = result.outputCapture?.stdout;
      if (result.exitCode !== 0 || result.signal || !capture?.enabled || capture.truncated || capture.encodingLoss || capture.droppedBytes) return null;
      return result.stdout;
    };
    const revision = run(['rev-parse', '--verify', 'HEAD^{commit}'])?.trim();
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(revision || '')) return { state: 'unavailable', revision: null };
    const status = run(['status', '--porcelain=v1', '--untracked-files=normal']);
    return { state: status === null ? 'unavailable' : status.trim() ? 'dirty' : 'clean-revision', revision };
  } catch (error) {
    observeStorageResource(error, { phase: 'ab-sweep-source-witness' }).requireSettled();
    record({ error: { code: data(error, 'code'), message: data(error, 'message'),
      causeCode: data(data(error, 'cause'), 'code'), result: data(error, 'result') } });
    return { state: 'unavailable', revision: null };
  }
};
