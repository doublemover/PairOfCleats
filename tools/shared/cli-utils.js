import {
  spawnResolvedSubprocessSync
} from '../../src/shared/subprocess/command-invocation.js';
import { exitLikeChildResult } from '../../src/shared/subprocess/exit-semantics.js';

/**
 * Exit current process using child-command exit semantics.
 *
 * @param {{status?:number|null,signal?:string|null}|null|undefined} result
 * @param {{exit:(code?:number)=>void,kill:(pid:number,signal:string)=>void,pid:number}} [proc=process]
 * @returns {void}
 */
export const exitLikeCommandResult = exitLikeChildResult;

/**
 * Run a command and return a normalized result.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @returns {{ok:boolean,status:number|null,signal:string|null,stdout?:string,stderr?:string}}
 */
export function runCommand(cmd, args, options = {}) {
  const resolvedArgs = Array.isArray(args) ? args : [];
  const effectiveEnv = options.env || process.env;
  const maxOutputBytes = Number.isFinite(Number(options.maxOutputBytes))
    ? Number(options.maxOutputBytes)
    : (Number.isFinite(Number(options.maxBuffer)) ? Number(options.maxBuffer) : undefined);
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(100, Math.floor(Number(options.timeoutMs)))
    : null;
  const result = spawnResolvedSubprocessSync(cmd, resolvedArgs, {
    cwd: options.cwd,
    env: effectiveEnv,
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

/**
 * Build minimal flag and option readers for small tool scripts.
 *
 * This intentionally preserves simple legacy parsing behavior: `--name value`
 * returns the next token as-is, and `--name=value` returns the raw suffix.
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 * @returns {{args:string[],hasFlag:(flag:string)=>boolean,readOption:(name:string,fallback?:string)=>string}}
 */
export function createArgReader(argv = process.argv.slice(2)) {
  const args = Array.isArray(argv) ? argv.map((arg) => String(arg)) : [];
  return {
    args,
    hasFlag(flag) {
      return args.includes(flag);
    },
    readOption(name, fallback = '') {
      const flag = name.startsWith('--') ? name : `--${name}`;
      for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === flag) {
          const next = args[i + 1];
          return typeof next === 'string' ? next : fallback;
        }
        if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) {
          return arg.slice(flag.length + 1);
        }
      }
      return fallback;
    }
  };
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
  const result = spawnResolvedSubprocessSync(command, Array.isArray(args) ? args : [], {
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
 * @param {{spaces?:number}} [options]
 */
export function emitJson(payload, stream = process.stdout, options = {}) {
  const spaces = Number.isInteger(options?.spaces) ? options.spaces : 2;
  stream.write(`${JSON.stringify(payload, null, spaces)}\n`);
}
