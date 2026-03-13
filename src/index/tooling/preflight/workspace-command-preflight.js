import {
  spawnSubprocess
} from '../../../shared/subprocess.js';
import { TOOLING_PREFLIGHT_REASON_CODES } from './contract.js';
import {
  buildWorkspaceCommandPreflightFingerprint,
  readWorkspaceCommandPreflightCacheHit,
  writeWorkspaceCommandPreflightCacheMarker
} from './workspace-command-preflight-cache.js';

const summarize = (value, maxChars = 220) => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
};

/**
 * Run a fail-open workspace probe command and normalize timeout/error/exit failures
 * to a shared degraded preflight classification shape.
 *
 * @param {{
 *   ctx?: { repoRoot?: string }|null,
 *   cwd?: string|null,
 *   cmd: string,
 *   args: string[],
 *   timeoutMs: number,
 *   abortSignal?: AbortSignal|null,
 *   reasonPrefix: string,
 *   label: string,
 *   log?:(line:string)=>void,
 *   successCache?:{
 *     repoRoot?:string,
 *     cacheRoot?:string|null,
 *     namespace:string,
 *     watchedFiles?:string[],
 *     extra?:object|null
 *   }|null
 * }} input
 * @returns {{
 *   state: 'ready'|'degraded',
 *   reasonCode: string|null,
 *   message: string,
 *   check: {name:string,status:'warn',message:string}|null,
 *   checks: Array<object>
 * }>}
 */
export const runWorkspaceCommandPreflight = async ({
  ctx,
  cwd = null,
  cmd,
  args,
  timeoutMs,
  abortSignal = null,
  reasonPrefix,
  label,
  log = () => {},
  successCache = null
}) => {
  const command = String(cmd || '').trim();
  const commandArgs = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(500, Math.floor(Number(timeoutMs)))
    : 5000;
  const prefix = String(reasonPrefix || '').trim().toLowerCase();
  const descriptor = String(label || 'workspace probe').trim() || 'workspace probe';
  if (!command || !prefix) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const cacheEnabled = successCache
    && typeof successCache === 'object'
    && typeof successCache.namespace === 'string'
    && successCache.namespace.trim();
  let successFingerprint = null;
  if (cacheEnabled) {
    try {
      successFingerprint = await buildWorkspaceCommandPreflightFingerprint({
        repoRoot: successCache.repoRoot || ctx?.repoRoot || process.cwd(),
        command,
        args: commandArgs,
        watchedFiles: successCache.watchedFiles || [],
        extra: successCache.extra || null
      });
      const cached = await readWorkspaceCommandPreflightCacheHit({
        repoRoot: successCache.repoRoot || ctx?.repoRoot || process.cwd(),
        cacheRoot: successCache.cacheRoot || null,
        namespace: successCache.namespace,
        fingerprint: successFingerprint
      });
      if (cached.hit) {
        if (typeof log === 'function') {
          log(`[tooling] ${descriptor} preflight cache hit.`);
        }
        return {
          state: 'ready',
          reasonCode: TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT,
          message: '',
          check: null,
          checks: [],
          cached: true
        };
      }
    } catch {}
  }
  try {
    const workingDir = String(cwd || ctx?.repoRoot || process.cwd());
    const result = await spawnSubprocess(command, commandArgs, {
      cwd: workingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      rejectOnNonZeroExit: false,
      captureStdout: true,
      captureStderr: true,
      outputMode: 'string',
      outputEncoding: 'utf8',
      timeoutMs: timeout,
      killTree: true,
      ...(abortSignal ? { signal: abortSignal } : {})
    });
    const exitCode = Number(result?.exitCode);
    if (Number.isFinite(exitCode) && exitCode === 0) {
      if (cacheEnabled && successFingerprint) {
        try {
          await writeWorkspaceCommandPreflightCacheMarker({
            repoRoot: successCache.repoRoot || ctx?.repoRoot || process.cwd(),
            cacheRoot: successCache.cacheRoot || null,
            namespace: successCache.namespace,
            fingerprint: successFingerprint,
            command,
            args: commandArgs,
            durationMs: result?.durationMs
          });
        } catch {}
      }
      return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
    }
    const summary = summarize(result?.stderr || result?.stdout);
    const message = summary
      ? `${descriptor} probe failed (exit ${Number.isFinite(exitCode) ? exitCode : 'unknown'}): ${summary}`
      : `${descriptor} probe failed (exit ${Number.isFinite(exitCode) ? exitCode : 'unknown'}).`;
    return {
      state: 'degraded',
      reasonCode: `${prefix}_failed`,
      message,
      check: {
        name: `${prefix}_failed`,
        status: 'warn',
        message
      },
      checks: []
    };
  } catch (error) {
    if (error?.code === 'ABORT_ERR') {
      throw error;
    }
    if (error?.code === 'SUBPROCESS_TIMEOUT') {
      const message = `${descriptor} probe timed out after ${timeout}ms.`;
      return {
        state: 'degraded',
        reasonCode: `${prefix}_timeout`,
        message,
        check: {
          name: `${prefix}_timeout`,
          status: 'warn',
          message
        },
        checks: []
      };
    }
    const message = `${descriptor} probe error: ${summarize(error?.message || error) || 'unknown error'}`;
    return {
      state: 'degraded',
      reasonCode: `${prefix}_error`,
      message,
      check: {
        name: `${prefix}_error`,
        status: 'warn',
        message
      },
      checks: []
    };
  }
};
