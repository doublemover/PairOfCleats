import { spawnSubprocess } from '../../shared/subprocess/runner.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

const PYTHON_CANDIDATES = ['python', 'python3'];

let pythonExecutable = null;
let pythonWarned = false;
let pythonCheckPromise = null;
let pythonCheckFailure = null;

async function checkPythonCandidate(candidate) {
  try {
    const result = await spawnSubprocess(
      candidate,
      ['-c', 'import sys; sys.stdout.write("ok")'],
      {
        stdio: ['ignore', 'pipe', 'ignore'],
        captureStdout: true,
        captureStderr: false,
        outputMode: 'string',
        outputEncoding: 'utf8',
        rejectOnNonZeroExit: false,
        timeoutMs: 3000,
        killTree: true,
        detached: false,
        name: 'python executable probe'
      }
    );
    return result?.exitCode === 0 && String(result?.stdout || '').trim() === 'ok';
  } catch (error) {
    observeStorageResource(error, { phase: 'python-executable-probe' }).requireSettled();
    return false;
  }
}

export async function findPythonExecutable(log) {
  if (pythonExecutable) return pythonExecutable;
  if (pythonCheckFailure) {
    pythonCheckFailure.requireSettled();
    pythonCheckFailure = null;
    pythonCheckPromise = null;
  }
  if (pythonCheckPromise) return pythonCheckPromise;
  pythonCheckPromise = (async () => {
    for (const candidate of PYTHON_CANDIDATES) {
      const ok = await checkPythonCandidate(candidate);
      if (ok) {
        pythonExecutable = candidate;
        break;
      }
    }
    if (!pythonExecutable && !pythonWarned) {
      if (typeof log === 'function') {
        log('Python AST unavailable (python not found); using heuristic chunking for .py.');
      }
      pythonWarned = true;
    }
    return pythonExecutable;
  })().catch(error => {
    pythonCheckFailure = observeStorageResource(error, { phase: 'python-executable-probe' });
    throw error;
  });
  return pythonCheckPromise;
}
