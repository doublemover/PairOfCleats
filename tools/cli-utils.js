import { execaSync } from 'execa';

/**
 * Run a command and return a normalized result.
 * @param {string} cmd
 * @param {string[]} args
 * @param {object} [options]
 * @returns {{ok:boolean,status:number|null,stdout?:string,stderr?:string}}
 */
export function runCommand(cmd, args, options = {}) {
  const result = execaSync(cmd, args, { reject: false, ...options });
  return {
    ok: result.exitCode === 0,
    status: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr
  };
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
