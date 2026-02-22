import { spawnSync } from 'node:child_process';
import { spawnSubprocessSync } from '../../src/shared/subprocess.js';

const resolveAnnArg = ({ annArg, annEnabled }) => {
  if (annArg) return String(annArg);
  if (annEnabled === true) return '--ann';
  if (annEnabled === false) return '--no-ann';
  return null;
};

const toStringOutput = (value) => {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  return String(value);
};

const createSearchCliError = (code, message, details) => {
  const err = new Error(message);
  err.code = code;
  if (details && typeof details === 'object') {
    Object.assign(err, details);
  }
  return err;
};

const parseJsonPayload = ({ stdout, jsonFallback, hasJsonFallback, details }) => {
  const source = stdout || (hasJsonFallback ? String(jsonFallback ?? '') : '');
  try {
    return JSON.parse(source);
  } catch (cause) {
    throw createSearchCliError(
      'ERR_SEARCH_CLI_JSON',
      'Search CLI returned invalid JSON.',
      { ...details, cause }
    );
  }
};

/**
 * Build search CLI args.
 * @param {{
 *   query:unknown,
 *   searchPath?:string,
 *   includeSearchPath?:boolean,
 *   json?:boolean,
 *   jsonCount?:number,
 *   stats?:boolean,
 *   compact?:boolean,
 *   backend?:string,
 *   topN?:number,
 *   topFlag?:string,
 *   annArg?:string,
 *   annEnabled?:boolean,
 *   mode?:string,
 *   explain?:boolean,
 *   repo?:string,
 *   extraArgs?:unknown[]
 * }} options
 * @returns {string[]}
 */
export function buildSearchCliArgs(options) {
  const {
    query,
    searchPath,
    includeSearchPath = false,
    json = true,
    jsonCount = 1,
    stats = false,
    compact = false,
    backend,
    topN,
    topFlag = '-n',
    annArg,
    annEnabled,
    mode,
    explain = false,
    repo,
    extraArgs = []
  } = options || {};

  const args = [];
  if (includeSearchPath) {
    if (!searchPath) throw new Error('searchPath is required when includeSearchPath=true.');
    args.push(String(searchPath));
  }
  args.push(String(query ?? ''));

  if (json) {
    const count = Math.max(1, Math.floor(Number(jsonCount) || 1));
    for (let i = 0; i < count; i += 1) args.push('--json');
  }
  if (stats) args.push('--stats');
  if (compact) args.push('--compact');
  if (backend) args.push('--backend', String(backend));
  if (topN !== undefined && topN !== null) args.push(String(topFlag || '-n'), String(topN));

  const ann = resolveAnnArg({ annArg, annEnabled });
  if (ann) args.push(ann);
  if (mode) args.push('--mode', String(mode));
  if (explain) args.push('--explain');
  if (repo) args.push('--repo', String(repo));

  if (Array.isArray(extraArgs) && extraArgs.length) {
    for (const arg of extraArgs) args.push(String(arg));
  }

  return args;
}

/**
 * Run search CLI with spawnSync and parse JSON output.
 * @param {{
 *   query:unknown,
 *   searchPath:string,
 *   json?:boolean,
 *   jsonCount?:number,
 *   stats?:boolean,
 *   compact?:boolean,
 *   backend?:string,
 *   topN?:number,
 *   topFlag?:string,
 *   annArg?:string,
 *   annEnabled?:boolean,
 *   mode?:string,
 *   explain?:boolean,
 *   repo?:string,
 *   extraArgs?:unknown[],
 *   env?:NodeJS.ProcessEnv,
 *   cwd?:string,
 *   encoding?:BufferEncoding,
 *   maxBuffer?:number,
 *   parseJson?:boolean,
 *   jsonFallback?:string,
 *   now?:()=>number
 * }} options
 * @returns {{payload:object|null,wallMs:number,result:import('node:child_process').SpawnSyncReturns<string>,args:string[],stdout:string,stderr:string}}
 */
export function runSearchCliWithSpawnSync(options) {
  const now = typeof options?.now === 'function' ? options.now : Date.now;
  const args = buildSearchCliArgs({ ...(options || {}), includeSearchPath: true });
  const hasJsonFallback = Object.prototype.hasOwnProperty.call(options || {}, 'jsonFallback');
  const spawnOptions = {
    cwd: options?.cwd,
    env: options?.env,
    encoding: options?.encoding || 'utf8'
  };
  if (Number.isFinite(Number(options?.maxBuffer))) {
    spawnOptions.maxBuffer = Number(options.maxBuffer);
  }

  const startedAt = now();
  const result = spawnSync(process.execPath, args, spawnOptions);
  const wallMs = now() - startedAt;
  const stdout = toStringOutput(result.stdout);
  const stderr = toStringOutput(result.stderr);

  if (result.status !== 0) {
    throw createSearchCliError(
      'ERR_SEARCH_CLI_EXIT',
      'Search CLI exited with non-zero status.',
      {
        args,
        stdout,
        stderr,
        exitCode: result.status ?? 1,
        spawnError: result.error || null,
        wallMs
      }
    );
  }

  let payload = null;
  if (options?.parseJson !== false) {
    payload = parseJsonPayload({
      stdout,
      jsonFallback: options?.jsonFallback,
      hasJsonFallback,
      details: {
        args,
        stdout,
        stderr,
        exitCode: result.status ?? 0,
        spawnError: result.error || null,
        wallMs
      }
    });
  }

  return { payload, wallMs, result, args, stdout, stderr };
}

/**
 * Run search CLI with spawnSubprocessSync and parse JSON output.
 * @param {{
 *   query:unknown,
 *   searchPath:string,
 *   json?:boolean,
 *   jsonCount?:number,
 *   stats?:boolean,
 *   compact?:boolean,
 *   backend?:string,
 *   topN?:number,
 *   topFlag?:string,
 *   annArg?:string,
 *   annEnabled?:boolean,
 *   mode?:string,
 *   explain?:boolean,
 *   repo?:string,
 *   extraArgs?:unknown[],
 *   env?:NodeJS.ProcessEnv,
 *   cwd?:string,
 *   maxOutputBytes?:number,
 *   parseJson?:boolean,
 *   jsonFallback?:string,
 *   now?:()=>number
 * }} options
 * @returns {{payload:object|null,wallMs:number,result:{exitCode:number|null,stdout?:string,stderr?:string},args:string[],stdout:string,stderr:string}}
 */
export function runSearchCliWithSubprocessSync(options) {
  const now = typeof options?.now === 'function' ? options.now : Date.now;
  const args = buildSearchCliArgs({ ...(options || {}), includeSearchPath: true });
  const hasJsonFallback = Object.prototype.hasOwnProperty.call(options || {}, 'jsonFallback');
  const startedAt = now();
  const result = spawnSubprocessSync(process.execPath, args, {
    cwd: options?.cwd,
    env: options?.env,
    maxOutputBytes: Number.isFinite(Number(options?.maxOutputBytes))
      ? Number(options.maxOutputBytes)
      : undefined,
    captureStdout: true,
    captureStderr: true,
    outputMode: 'string',
    rejectOnNonZeroExit: false
  });
  const wallMs = now() - startedAt;
  const stdout = toStringOutput(result.stdout);
  const stderr = toStringOutput(result.stderr);

  if (result.exitCode !== 0) {
    throw createSearchCliError(
      'ERR_SEARCH_CLI_EXIT',
      'Search CLI exited with non-zero status.',
      {
        args,
        stdout,
        stderr,
        exitCode: result.exitCode ?? 1,
        spawnError: null,
        wallMs
      }
    );
  }

  let payload = null;
  if (options?.parseJson !== false) {
    payload = parseJsonPayload({
      stdout,
      jsonFallback: options?.jsonFallback,
      hasJsonFallback,
      details: {
        args,
        stdout,
        stderr,
        exitCode: result.exitCode ?? 0,
        spawnError: null,
        wallMs
      }
    });
  }

  return { payload, wallMs, result, args, stdout, stderr };
}
