import { spawn } from 'node:child_process';

const PYTHON_CANDIDATES = ['python', 'python3'];

let pythonExecutable = null;
let pythonWarned = false;
let pythonCheckPromise = null;

async function checkPythonCandidate(candidate) {
  return new Promise((resolve) => {
    const proc = spawn(candidate, ['-c', 'import sys; sys.stdout.write("ok")'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let output = '';
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && output.trim() === 'ok'));
  });
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
