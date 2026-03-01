import path from 'node:path';
import { getToolingDir } from '../../src/shared/dict-utils.js';
import { resolveEnvPath, resolvePathEnvKey } from '../../src/shared/env-path.js';
import { resolveToolingCommandProfile } from '../../src/index/tooling/command-resolver.js';
import { __testLspSessionPool } from '../../src/integrations/tooling/providers/lsp/session-pool.js';
import { getTrackedSubprocessCount, terminateTrackedSubprocesses } from '../../src/shared/subprocess.js';
import { withTemporaryEnv } from './test-env.js';
import { skip } from './skip.js';

const normalizePathKey = (value) => (
  process.platform === 'win32'
    ? String(value || '').toLowerCase()
    : String(value || '')
);

const dedupePathEntries = (entries) => {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    const value = String(entry || '').trim();
    if (!value) continue;
    const key = normalizePathKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
};

const buildLspPathValue = ({
  repoRoot,
  includeFixtures,
  extraPrepend
}) => {
  const toolingBin = path.join(getToolingDir(repoRoot), 'bin');
  const fixturesBin = path.join(repoRoot, 'tests', 'fixtures', 'lsp', 'bin');
  const currentPath = resolveEnvPath(process.env);
  const merged = dedupePathEntries([
    ...extraPrepend,
    toolingBin,
    ...String(currentPath)
      .split(path.delimiter)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
    includeFixtures ? fixturesBin : ''
  ]);
  const pathKey = resolvePathEnvKey(process.env, {
    preferredKey: process.platform === 'win32' ? 'Path' : 'PATH'
  });
  return {
    pathKey,
    pathValue: merged.join(path.delimiter)
  };
};

/**
 * Prepend the real tooling bin directory before fixture stubs for LSP tests.
 * This ensures tests exercise installed language servers when present while
 * preserving fixture fallbacks when a server is missing.
 *
 * @param {{
 *   repoRoot?: string,
 *   includeFixtures?: boolean,
 *   extraPrepend?: string[]
 * }} [options]
 * @returns {() => Promise<void>}
 */
export function prependLspTestPath(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const includeFixtures = options.includeFixtures !== false;
  const extraPrepend = Array.isArray(options.extraPrepend) ? options.extraPrepend : [];
  const { pathKey, pathValue } = buildLspPathValue({
    repoRoot,
    includeFixtures,
    extraPrepend
  });
  const hadPathKey = Object.prototype.hasOwnProperty.call(process.env, pathKey);
  const originalPath = hadPathKey ? process.env[pathKey] : '';
  process.env[pathKey] = pathValue;
  return async () => {
    try {
      await cleanupLspTestRuntime({ reason: 'lsp_test_path_restore', strict: true });
    } finally {
      if (hadPathKey) {
        process.env[pathKey] = originalPath;
      } else {
        delete process.env[pathKey];
      }
    }
  };
}

/**
 * Best-effort cleanup for pooled LSP sessions and tracked subprocesses in tests.
 *
 * @param {{reason?:string}} [options]
 * @returns {Promise<void>}
 */
export async function cleanupLspTestRuntime({ reason = 'lsp_test_cleanup', strict = false } = {}) {
  const summary = {
    poolResetOk: true,
    poolResetError: null,
    trackedCleanup: null,
    trackedCleanupError: null,
    trackedRemaining: null
  };
  try {
    if (typeof __testLspSessionPool.reset === 'function') {
      await __testLspSessionPool.reset();
    } else {
      __testLspSessionPool.killAllNow();
    }
  } catch (error) {
    summary.poolResetOk = false;
    summary.poolResetError = error;
  }
  try {
    summary.trackedCleanup = await terminateTrackedSubprocesses({
      reason,
      force: true
    });
  } catch (error) {
    summary.trackedCleanupError = error;
  }
  let trackedRemaining = Number(getTrackedSubprocessCount()) || 0;
  for (let attempt = 0; attempt < 3 && trackedRemaining > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      summary.trackedCleanup = await terminateTrackedSubprocesses({
        reason: `${reason}_retry_${attempt + 1}`,
        force: true
      });
    } catch (error) {
      summary.trackedCleanupError = error;
    }
    trackedRemaining = Number(getTrackedSubprocessCount()) || 0;
  }
  summary.trackedRemaining = trackedRemaining;
  if (strict && (!summary.poolResetOk || summary.trackedCleanupError || summary.trackedRemaining > 0)) {
    const details = [
      !summary.poolResetOk ? `poolReset=${summary.poolResetError?.message || summary.poolResetError}` : null,
      summary.trackedCleanupError
        ? `trackedCleanup=${summary.trackedCleanupError?.message || summary.trackedCleanupError}`
        : null,
      summary.trackedRemaining > 0 ? `trackedRemaining=${summary.trackedRemaining}` : null
    ].filter(Boolean).join(', ');
    throw new Error(`LSP test runtime cleanup failed (${details || 'unknown reason'})`);
  }
  return summary;
}

/**
 * Run a callback with PATH configured for LSP tests and always restore state.
 *
 * @template T
 * @param {{
 *   repoRoot?: string,
 *   includeFixtures?: boolean,
 *   extraPrepend?: string[]
 * }} options
 * @param {() => Promise<T> | T} fn
 * @returns {Promise<T>}
 */
export async function withLspTestPath(options, fn) {
  const repoRoot = options?.repoRoot || process.cwd();
  const includeFixtures = options?.includeFixtures !== false;
  const extraPrepend = Array.isArray(options?.extraPrepend) ? options.extraPrepend : [];
  const { pathKey, pathValue } = buildLspPathValue({
    repoRoot,
    includeFixtures,
    extraPrepend
  });
  return await withTemporaryEnv({ [pathKey]: pathValue }, async () => {
    try {
      return await fn();
    } finally {
      await cleanupLspTestRuntime({ reason: 'lsp_test_path_restore', strict: true });
    }
  });
}

/**
 * Resolve and probe an LSP provider command in the current test environment.
 *
 * @param {{
 *   providerId: string,
 *   cmd?: string,
 *   args?: string[],
 *   repoRoot?: string,
 *   toolingConfig?: object
 * }} input
 * @returns {ReturnType<typeof resolveToolingCommandProfile>}
 */
export function probeLspCommandForTest(input) {
  const repoRoot = input?.repoRoot || process.cwd();
  return resolveToolingCommandProfile({
    providerId: input?.providerId,
    cmd: input?.cmd || input?.providerId,
    args: Array.isArray(input?.args) ? input.args : [],
    repoRoot,
    toolingConfig: input?.toolingConfig || {}
  });
}

/**
 * Require a provider command probe to succeed or skip the test.
 *
 * @param {{
 *   providerId: string,
 *   cmd?: string,
 *   args?: string[],
 *   repoRoot?: string,
 *   toolingConfig?: object,
 *   reason?: string
 * }} input
 * @returns {ReturnType<typeof resolveToolingCommandProfile>}
 */
export function requireLspCommandOrSkip(input) {
  const profile = probeLspCommandForTest(input);
  if (profile?.probe?.ok) return profile;
  const providerLabel = String(input?.providerId || input?.cmd || 'lsp').trim() || 'lsp';
  skip(input?.reason || `Skipping test; ${providerLabel} command probe failed.`);
  return profile;
}
