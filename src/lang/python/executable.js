import { spawnSubprocess } from '../../shared/subprocess.js';

const PYTHON_CANDIDATES = ['python', 'python3'];

let pythonExecutable = null;
let pythonWarned = false;
let pythonCheckPromise = null;

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
  } catch {
    return false;
  }
}

export async function findPythonExecutable(log) {
  if (pythonExecutable) return pythonExecutable;
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
  })();
  return pythonCheckPromise;
}
