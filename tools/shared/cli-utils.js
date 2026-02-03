import { execaSync } from 'execa';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';

/**
 * Run a command and return a normalized result.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @returns {{ok:boolean,status:number|null,stdout?:string,stderr?:string}}
 */
export function runCommand(cmd, args, options = {}) {
  if (cmd === process.execPath) {
    const result = spawnSubprocessSync(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio,
      shell: options.shell,
      captureStdout: true,
      captureStderr: true,
      outputMode: 'string',
      rejectOnNonZeroExit: false
    });
    return {
      ok: result.exitCode === 0,
      status: result.exitCode ?? null,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : ''
    };
  }
  const result = execaSync(cmd, args, { reject: false, ...options });
  return {
    ok: result.exitCode === 0,
    status: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
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
  try {
    const result = runCommand(cmd, args, { encoding: 'utf8', stdio: 'ignore', ...options });
    return result.ok;
  } catch {
    return false;
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
    process.exit(result.status ?? 1);
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
