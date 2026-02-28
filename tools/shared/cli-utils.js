import { spawnSubprocessSync } from '../../src/shared/subprocess.js';

/**
 * Exit current process using child-command exit semantics.
 *
 * @param {{status?:number|null,signal?:string|null}|null|undefined} result
 * @param {{exit:(code?:number)=>void,kill:(pid:number,signal:string)=>void,pid:number}} [proc=process]
 * @returns {void}
 */
export function exitLikeCommandResult(result, proc = process) {
  const status = Number.isInteger(result?.status) ? Number(result.status) : null;
  if (status !== null) {
    proc.exit(status);
    return;
  }

  const signal = typeof result?.signal === 'string' && result.signal.trim().length > 0
    ? result.signal.trim()
    : null;
  if (signal) {
    try {
      proc.kill(proc.pid, signal);
      return;
    } catch {}
  }

  proc.exit(1);
}

/**
 * Run a command and return a normalized result.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @returns {{ok:boolean,status:number|null,signal:string|null,stdout?:string,stderr?:string}}
 */
export function runCommand(cmd, args, options = {}) {
  const maxOutputBytes = Number.isFinite(Number(options.maxOutputBytes))
    ? Number(options.maxOutputBytes)
    : (Number.isFinite(Number(options.maxBuffer)) ? Number(options.maxBuffer) : undefined);
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(100, Math.floor(Number(options.timeoutMs)))
    : null;
  const result = spawnSubprocessSync(cmd, Array.isArray(args) ? args : [], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    input: options.input,
    shell: options.shell,
    outputEncoding: options.outputEncoding || options.encoding || 'utf8',
    maxOutputBytes,
    timeoutMs: timeoutMs ?? undefined,
    captureStdout: true,
    captureStderr: true,
    outputMode: 'string',
    rejectOnNonZeroExit: false
  });
  return {
    ok: result.exitCode === 0,
    status: result.exitCode ?? null,
    signal: typeof result.signal === 'string' ? result.signal : null,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : ''
  };
}

/**
 * Test whether a command can run successfully.
 * @param {string} cmd
 * @param {string[]} [args]
 * @param {object} [options]
 * @returns {boolean}
 */
export function canRunCommand(cmd, args = ['--version'], options = {}) {
  return probeCommand(cmd, args, options).ok === true;
}

const isMissingCommandText = (stderr = '', stdout = '') => {
  const output = `${String(stderr || '')} ${String(stdout || '')}`.toLowerCase();
  if (!output.trim()) return false;
  return output.includes('command not found')
    || output.includes('is not recognized as an internal or external command')
    || output.includes('no such file or directory')
    || output.includes('enoent')
    || output.includes('cannot find the file');
};

const pickProbeOutcomeFromExit = ({ status, signal, stderr, stdout }) => {
  if (typeof signal === 'string' && signal.trim()) return 'terminated';
  if (Number.isInteger(status) && status === 0) return 'ok';
  if (Number.isInteger(status) && status === 127) return 'missing';
  if (isMissingCommandText(stderr, stdout)) return 'missing';
  if (Number.isInteger(status)) return 'nonzero';
  return 'inconclusive';
};

/**
 * Run a command probe and return structured outcome metadata.
 *
 * @param {string} cmd
 * @param {string[]} [args]
 * @param {object} [options]
 * @returns {{
 *   ok:boolean,
 *   outcome:'ok'|'missing'|'timeout'|'terminated'|'nonzero'|'spawn_error'|'inconclusive',
 *   status:number|null,
 *   signal:string|null,
 *   errorCode:string|null,
 *   stderr?:string,
 *   stdout?:string
 * }}
 */
export function probeCommand(cmd, args = ['--version'], options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(100, Math.floor(Number(options.timeoutMs)))
    : 4000;
  try {
    const result = runCommand(cmd, args, {
      encoding: 'utf8',
      stdio: 'ignore',
      ...options,
      timeoutMs
    });
    const outcome = pickProbeOutcomeFromExit(result);
    return {
      ok: outcome === 'ok',
      outcome,
      status: Number.isInteger(result?.status) ? Number(result.status) : null,
      signal: typeof result?.signal === 'string' ? result.signal : null,
      errorCode: null,
      stdout: typeof result?.stdout === 'string' ? result.stdout : '',
      stderr: typeof result?.stderr === 'string' ? result.stderr : ''
    };
  } catch (error) {
    const result = error?.result || null;
    const errorCode = typeof error?.code === 'string'
      ? error.code
      : (typeof result?.errorCode === 'string' ? result.errorCode : null);
    const outcome = error?.name === 'SubprocessTimeoutError' || errorCode === 'ETIMEDOUT'
      ? 'timeout'
      : (errorCode === 'ENOENT' ? 'missing' : 'spawn_error');
    return {
      ok: false,
      outcome,
      status: Number.isInteger(result?.status) ? Number(result.status) : null,
      signal: typeof result?.signal === 'string' ? result.signal : null,
      errorCode,
      stdout: typeof result?.stdout === 'string' ? result.stdout : '',
      stderr: typeof result?.stderr === 'string' ? result.stderr : ''
    };
  }
}

/**
 * Run a command and exit if it fails.
 * @param {string} label
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @returns {{ok:boolean,status:number|null,stdout?:string,stderr?:string}}
 */
export function runCommandOrExit(label, cmd, args, options = {}) {
  const result = runCommand(cmd, args, options);
  if (!result.ok) {
    console.error(`Failed: ${label || cmd}`);
    exitLikeCommandResult(result);
  }
  return result;
}

/**
 * Run a subprocess via shared spawn wrapper and exit on non-zero status.
 * @param {{
 *   command:string,
 *   args:string[],
 *   label?:string,
 *   cwd?:string,
 *   env?:NodeJS.ProcessEnv,
 *   stdio?:import('node:child_process').SpawnSyncOptions['stdio'],
 *   shell?:boolean|string,
 *   logError?:(message:string)=>void,
 *   onFailure?:(result:object)=>void
 * }} options
 * @returns {object}
 */
export function runSubprocessOrExit(options) {
  const {
    command,
    args,
    label,
    cwd,
    env,
    stdio = 'inherit',
    shell,
    logError = console.error,
    onFailure
  } = options || {};
  const result = spawnSubprocessSync(command, Array.isArray(args) ? args : [], {
    cwd,
    env,
    stdio,
    shell,
    rejectOnNonZeroExit: false
  });
  if (result.exitCode !== 0) {
    logError(`Failed: ${label || command}`);
    if (typeof onFailure === 'function') onFailure(result);
    exitLikeCommandResult({
      status: result.exitCode,
      signal: result.signal
    });
  }
  return result;
}

/**
 * Emit JSON to stdout with a trailing newline.
 * @param {unknown} payload
 * @param {NodeJS.WritableStream} [stream]
 */
export function emitJson(payload, stream = process.stdout) {
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}
