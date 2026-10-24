import { spawnResolvedSubprocess } from '../../../shared/subprocess/command-invocation.js';
import { isAbortError, throwIfAborted } from '../../../shared/abort.js';
import { resolveToolingCommandProfile } from '../command-resolver.js';
import { runWithManagedCommandInstallation } from '../managed-command-lifetime.js';
import { isResolvedCommandTrusted } from '../../../shared/config-authority.js';
import { resolveToolRoot } from '../../../shared/dict-utils.js';
import { findBinaryOnPath } from '../binary-utils.js';
import { resolveProviderWorkspaceExecutionAuthority } from '../workspace-execution.js';
import { resolveNoProvisionToolingEnvironment } from '../../../shared/toolchain-env.js';
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
 * Run an admitted workspace probe command. Operational failures can degrade;
 * command denial, pending ownership and cancellation cannot become cache hits or
 * raw-command fallbacks.
 *
 * @param {{
 *   ctx?: { repoRoot?: string }|null,
 *   cwd?: string|null,
 *   cmd: string,
 *   args: string[],
 *   timeoutMs: number,
 *   abortSignal?: AbortSignal|null,
 *   reasonPrefix: string,
 *   providerId?: string,
 *   label: string,
 *   log?:(line:string)=>void,
 *   successCache?:{
 *     repoRoot?:string,
 *     cacheRoot?:string|null,
 *     namespace:string,
 *     watchedFiles?:string[],
 *     extra?:object|null
 *   }|null,
 *   cacheMaxAgeMsByState?:Record<string, number>|null
 * }} input
 * @returns {{
 *   state: 'ready'|'degraded'|'blocked',
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
  providerId = null,
  label,
  log = () => {},
  successCache = null,
  cacheMaxAgeMsByState = null
}) => {
  throwIfAborted(abortSignal);
  const requestedCommand = String(cmd || '').trim();
  const requestedArgs = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(500, Math.floor(Number(timeoutMs)))
    : 5000;
  const prefix = String(reasonPrefix || '').trim().toLowerCase();
  const descriptor = String(label || 'workspace probe').trim() || 'workspace probe';
  if (!requestedCommand || !prefix) {
    return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
  }
  const ownerId = providerId || prefix;
  const workingDir = String(cwd || ctx?.repoRoot || process.cwd());
  const profile = resolveToolingCommandProfile({ providerId: ownerId, cmd: requestedCommand, args: requestedArgs,
    repoRoot: ctx?.repoRoot || cwd || process.cwd(), toolingConfig: ctx?.toolingConfig || {} });
  throwIfAborted(abortSignal);
  if (profile.resolved?.mode === 'blocked' || profile.probe?.validationFailure || profile.probe?.cacheOwnershipPending === true) {
    const pending = profile.probe?.cacheOwnershipPending === true;
    const reasonCode = `${prefix}_${pending ? 'settlement_pending' : 'command_denied'}`;
    const message = `${descriptor} cannot be admitted (${profile.probe?.validationFailure?.reasonCode || profile.resolved?.reason || reasonCode}).`;
    return { state: 'blocked', blockProvider: true, reasonCode, message,
      check: { name: reasonCode, status: 'warn', message }, checks: [] };
  }
  const command = profile.resolved.cmd;
  const commandArgs = profile.resolved.args;
  const environment = resolveNoProvisionToolingEnvironment(process.env, { command, providerId: ownerId,
    cwd: workingDir, toolingRoot: ctx?.toolingConfig?.dir || null });
  const currentAuthority = () => {
    const workspace = resolveProviderWorkspaceExecutionAuthority({ repoRoot: ctx?.repoRoot || workingDir,
      workspaceRoot: workingDir, providerId: ownerId, server: { cmd: command } });
    if (workspace) return workspace;
    const commandPath = findBinaryOnPath(command) || command;
    if (isResolvedCommandTrusted({ commandPath, repoRoot: ctx?.repoRoot || workingDir, toolRoot: resolveToolRoot() })) return null;
    const reasonCode = `${prefix}_command_denied`;
    const message = `${descriptor} command authority was revoked before result admission or launch.`;
    return { state: 'blocked', blockProvider: true, reasonCode, message,
      check: { name: reasonCode, status: 'warn', message }, checks: [] };
  };
  const buildCachedResult = (marker) => {
    const state = String(marker?.state || 'ready').trim() || 'ready';
    const check = marker?.check && typeof marker.check === 'object'
      ? {
        name: String(marker.check.name || '').trim() || `${prefix}_${state}`,
        status: String(marker.check.status || '').trim() || (state === 'ready' ? 'info' : 'warn'),
        message: String(marker.check.message || marker.message || '').trim()
      }
      : null;
    const checks = Array.isArray(marker?.checks)
      ? marker.checks
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          name: String(entry.name || '').trim() || null,
          status: String(entry.status || '').trim() || null,
          message: String(entry.message || '').trim() || ''
        }))
      : [];
    return {
      state,
      reasonCode: String(marker?.reasonCode || '').trim() || null,
      message: String(marker?.message || '').trim() || '',
      check,
      checks,
      cached: true
    };
  };
  const writeCacheMarker = async (payload = {}) => {
    throwIfAborted(abortSignal);
    if (!cacheEnabled || !successFingerprint) return;
    try {
      await writeWorkspaceCommandPreflightCacheMarker({
        repoRoot: successCache.repoRoot || ctx?.repoRoot || process.cwd(),
        cacheRoot: successCache.cacheRoot || null,
        namespace: successCache.namespace,
        fingerprint: successFingerprint,
        command,
        args: commandArgs,
        durationMs: payload.durationMs,
        state: payload.state,
        reasonCode: payload.reasonCode,
        message: payload.message,
        check: payload.check,
        checks: payload.checks,
        signal: abortSignal
      });
      throwIfAborted(abortSignal);
    } catch (error) { if (isAbortError(error) || error?.cacheOwnershipPending === true) throw error; }
  };
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
        extra: successCache.extra || null,
        environment,
        signal: abortSignal
      });
      throwIfAborted(abortSignal);
      const cached = await readWorkspaceCommandPreflightCacheHit({
        repoRoot: successCache.repoRoot || ctx?.repoRoot || process.cwd(),
        cacheRoot: successCache.cacheRoot || null,
        namespace: successCache.namespace,
        fingerprint: successFingerprint,
        cacheMaxAgeMsByState
      });
      throwIfAborted(abortSignal);
      if (cached.hit) {
        const denied = currentAuthority();
        if (denied) return denied;
        if (typeof log === 'function') {
          log(`[tooling] ${descriptor} preflight cache hit.`);
        }
        const cachedResult = buildCachedResult(cached.marker);
        if (cachedResult.state === 'ready') {
          cachedResult.reasonCode = TOOLING_PREFLIGHT_REASON_CODES.CACHE_HIT;
        }
        throwIfAborted(abortSignal);
        return cachedResult;
      }
    } catch (error) { if (isAbortError(error)) throw error; }
  }
  try {
    throwIfAborted(abortSignal);
    const denied = currentAuthority();
    if (denied) return denied;
    const result = await runWithManagedCommandInstallation({ command, signal: abortSignal, beforeSpawn: () => {
      const revoked = currentAuthority();
      if (revoked) throw Object.assign(new Error(revoked.message), { code: 'ERR_WORKSPACE_COMMAND_DENIED', admission: revoked });
    } }, ({ onSpawn }) => {
      return spawnResolvedSubprocess(command, commandArgs, {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        rejectOnNonZeroExit: false,
        captureStdout: true,
        captureStderr: true,
        outputMode: 'string',
        outputEncoding: 'utf8',
        timeoutMs: timeout,
        env: environment,
        killTree: true,
        ...(onSpawn ? { onSpawn } : {}),
        ...(abortSignal ? { signal: abortSignal } : {})
      });
    });
    throwIfAborted(abortSignal);
    const revoked = currentAuthority();
    if (revoked) return revoked;
    const exitCode = Number(result?.exitCode);
    if (Number.isFinite(exitCode) && exitCode === 0) {
      await writeCacheMarker({
        state: 'ready',
        reasonCode: null,
        message: '',
        check: null,
        checks: [],
        durationMs: result?.durationMs
      });
      return { state: 'ready', reasonCode: null, message: '', check: null, checks: [] };
    }
    const summary = summarize(result?.stderr || result?.stdout);
    const message = summary
      ? `${descriptor} probe failed (exit ${Number.isFinite(exitCode) ? exitCode : 'unknown'}): ${summary}`
      : `${descriptor} probe failed (exit ${Number.isFinite(exitCode) ? exitCode : 'unknown'}).`;
    const failureResult = {
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
    await writeCacheMarker({
      ...failureResult,
      durationMs: result?.durationMs
    });
    return failureResult;
  } catch (error) {
    if (error?.code === 'ERR_WORKSPACE_COMMAND_DENIED') return error.admission;
    if (isAbortError(error) || error?.cacheOwnershipPending === true) {
      throw error;
    }
    throwIfAborted(abortSignal);
    if (error?.code === 'SUBPROCESS_TIMEOUT') {
      const message = `${descriptor} probe timed out after ${timeout}ms.`;
      const timeoutResult = {
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
      await writeCacheMarker(timeoutResult);
      return timeoutResult;
    }
    const message = `${descriptor} probe error: ${summarize(error?.message || error) || 'unknown error'}`;
    const errorResult = {
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
    await writeCacheMarker(errorResult);
    return errorResult;
  }
};
