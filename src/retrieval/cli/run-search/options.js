import { createError, ERROR_CODES, isErrorCode } from '../../../shared/error-codes.js';
import { getSearchUsage, parseSearchArgs } from '../../cli-args.js';
import { runFederatedSearch } from '../../federation/coordinator.js';
import { parseFederatedCliRequest } from '../../federation/args.js';
import { stableStringify } from '../../../shared/stable-json.js';
import { inferJsonOutputFromArgs } from '../runner.js';

/**
 * Parse CLI args and preserve legacy parse-error emission behavior.
 *
 * @param {{
 *   rawArgs:string[],
 *   emitOutput:boolean,
 *   exitOnError:boolean,
 *   recordSearchMetrics:(status:string)=>void
 * }} input
 * @returns {Record<string, any>}
 */
export const parseCliArgsOrThrow = ({
  rawArgs,
  emitOutput,
  exitOnError,
  recordSearchMetrics
}) => {
  try {
    return parseSearchArgs(rawArgs);
  } catch (err) {
    recordSearchMetrics('error');
    const { jsonOutput } = inferJsonOutputFromArgs(rawArgs);
    const message = err && typeof err.message === 'string' && err.message.trim()
      ? err.message
      : 'Invalid arguments.';

    if (emitOutput) {
      if (jsonOutput) {
        console.log(JSON.stringify({ ok: false, code: ERROR_CODES.INVALID_REQUEST, message }));
      } else {
        console.error(message);
      }
    }

    if (exitOnError) process.exit(1);

    const error = createError(ERROR_CODES.INVALID_REQUEST, message);
    error.emitted = true;
    error.cause = err;
    throw error;
  }
};

/**
 * Resolve positional query text from parsed argv.
 *
 * @param {Record<string, any>} argv
 * @returns {string}
 */
export const extractPositionalQuery = (argv) => (
  Array.isArray(argv?._)
    ? argv._
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ')
      .trim()
    : ''
);

/**
 * Emit legacy missing-query output and throw INVALID_REQUEST.
 *
 * @param {{
 *   jsonOutput:boolean,
 *   emitOutput:boolean,
 *   exitOnError:boolean,
 *   recordSearchMetrics:(status:string)=>void
 * }} input
 */
export const emitMissingQueryAndThrow = ({
  jsonOutput,
  emitOutput,
  exitOnError,
  recordSearchMetrics
}) => {
  recordSearchMetrics('error');
  const message = getSearchUsage();
  if (emitOutput) {
    if (jsonOutput) {
      console.log(JSON.stringify({ ok: false, code: ERROR_CODES.INVALID_REQUEST, message }));
    } else {
      console.error(message);
    }
  }
  if (exitOnError) process.exit(1);
  const error = createError(ERROR_CODES.INVALID_REQUEST, message);
  error.emitted = true;
  throw error;
};

/**
 * Resolve optional workspace path argument.
 *
 * @param {Record<string, any>} argv
 * @returns {string}
 */
export const extractWorkspacePath = (argv) => (
  typeof argv.workspace === 'string' ? argv.workspace.trim() : ''
);

/**
 * Execute federated search path when `--workspace` is present.
 * Returns payload on handled request; otherwise returns null.
 *
 * @param {{
 *   rawArgs:string[],
 *   workspacePath:string,
 *   signal:AbortSignal|null,
 *   indexCache:object|null,
 *   sqliteCache:object|null,
 *   emitOutput:boolean,
 *   exitOnError:boolean,
 *   recordSearchMetrics:(status:string)=>void
 * }} input
 * @returns {Promise<object|null>}
 */
export const runFederatedIfRequested = async ({
  rawArgs,
  workspacePath,
  signal,
  indexCache,
  sqliteCache,
  emitOutput,
  exitOnError,
  recordSearchMetrics
}) => {
  if (!workspacePath) return null;
  try {
    const federatedRequest = parseFederatedCliRequest(rawArgs);
    const payload = await runFederatedSearch(federatedRequest, {
      signal,
      indexCache,
      sqliteCache
    });
    if (emitOutput) {
      process.stdout.write(`${stableStringify(payload)}\n`);
    }
    recordSearchMetrics('ok');
    return payload;
  } catch (err) {
    recordSearchMetrics('error');
    if (emitOutput && !err?.emitted) {
      const code = isErrorCode(err?.code) ? err.code : (err?.code || ERROR_CODES.INTERNAL);
      const message = err?.message || 'Federated search failed.';
      const payload = {
        ok: false,
        backend: 'federated',
        error: {
          code,
          message,
          details: {}
        }
      };
      process.stdout.write(`${stableStringify(payload)}\n`);
    }
    if (exitOnError) process.exit(1);
    throw err;
  }
};
