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
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(ok);
    };
    const timeout = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      finish(false);
    }, 3000);
    proc.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    proc.on('error', () => finish(false));
    proc.on('close', (code) => finish(code === 0 && output.trim() === 'ok'));
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
