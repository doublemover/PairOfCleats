import { execa, execaSync } from 'execa';
import { ERROR_CODES } from '../../src/shared/error-codes.js';
import { incTimeout } from '../../src/shared/metrics.js';

/**
 * Run a node command and return stdout.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
export function runNodeSync(cwd, args) {
  const result = execaSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    reject: false
  });
  if (result.exitCode !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    const message = stderr || stdout || `Command failed: ${args.join(' ')}`;
    const error = new Error(message.trim());
    error.code = result.exitCode;
    error.stderr = stderr;
    error.stdout = stdout;
    throw error;
  }
  return result.stdout || '';
}

/**
 * Build a line buffer for progress streaming.
 * @param {(line:string)=>void} onLine
 * @returns {{push:(text:string)=>void,flush:()=>void}}
 */
function createLineBuffer(onLine) {
  let buffer = '';
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) onLine(trimmed);
      }
    },
    flush() {
      const trimmed = buffer.trim();
      if (trimmed) onLine(trimmed);
      buffer = '';
    }
  };
}

/**
 * Run a node command asynchronously with optional stderr streaming.
 * @param {string} cwd
 * @param {string[]} args
 * @param {{streamOutput?:boolean,onLine?:(payload:{stream:string,line:string})=>void,maxBufferBytes?:number}} [options]
 * @returns {Promise<{stdout:string,stderr:string}>}
 */
export function runNodeAsync(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execa(process.execPath, args, {
      cwd,
      reject: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const streamOutput = options.streamOutput === true;
    const onLine = typeof options.onLine === 'function' ? options.onLine : null;
    const maxBufferBytes = Number.isFinite(Number(options.maxBufferBytes))
      ? Math.max(0, Number(options.maxBufferBytes))
      : 1024 * 1024;
    const appendLimited = (current, text) => {
      if (!maxBufferBytes) return current + text;
      const combined = current + text;
      if (combined.length <= maxBufferBytes) return combined;
      return combined.slice(combined.length - maxBufferBytes);
    };
    const stdoutBuffer = onLine
      ? createLineBuffer((line) => onLine({ stream: 'stdout', line }))
      : null;
    const stderrBuffer = onLine
      ? createLineBuffer((line) => onLine({ stream: 'stderr', line }))
      : null;
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout = appendLimited(stdout, text);
      if (streamOutput) process.stderr.write(text);
      stdoutBuffer?.push(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = appendLimited(stderr, text);
      if (streamOutput) process.stderr.write(text);
      stderrBuffer?.push(text);
    });
    child
      .then((result) => {
        stdoutBuffer?.flush();
        stderrBuffer?.flush();
        if (result.exitCode === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const error = new Error(stderr.trim() || `Command failed: ${args.join(' ')}`);
        error.code = result.exitCode;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      })
      .catch((err) => {
        const error = new Error(err?.shortMessage || err?.message || 'Command failed');
        error.code = err?.exitCode;
        error.stdout = err?.stdout || stdout;
        error.stderr = err?.stderr || stderr;
        reject(error);
      });
  });
}

/**
 * Run a tool script with progress notifications.
 * @param {{repoPath:string,scriptArgs:string[],context?:object,startMessage?:string,doneMessage?:string}} input
 * @returns {Promise<string>}
 */
export async function runToolWithProgress({ repoPath, scriptArgs, context = {}, startMessage, doneMessage }) {
  const progress = typeof context.progress === 'function' ? context.progress : null;
  const progressLine = progress
    ? ({ stream, line }) => progress({ message: line, stream })
    : null;
  if (progress && startMessage) {
    progress({ message: startMessage, phase: 'start' });
  }
  const { stdout } = await runNodeAsync(repoPath, scriptArgs, {
    streamOutput: true,
    onLine: progressLine
  });
  if (progress && doneMessage) {
    progress({ message: doneMessage, phase: 'done' });
  }
  return stdout || '';
}

export function parseCountSummary(stdout) {
  const match = String(stdout || '').match(/downloaded=(\d+)\s+skipped=(\d+)/i);
  if (!match) return null;
  return {
    downloaded: Number(match[1]),
    skipped: Number(match[2])
  };
}

export function parseExtensionPath(stdout) {
  const match = String(stdout || '').match(/Extension present at (.+)$/im);
  return match ? match[1].trim() : null;
}

export const withTimeout = async (promise, timeoutMs, { label, onTimeout } = {}) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await promise;
  }
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      onTimeout?.();
      incTimeout({ surface: 'mcp', operation: 'tool' });
      const error = new Error(`Tool timeout after ${timeoutMs}ms (${label || 'tool'}).`);
      error.code = ERROR_CODES.TOOL_TIMEOUT;
      error.timeoutMs = timeoutMs;
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
