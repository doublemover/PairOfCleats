import path from 'node:path';
import { getToolingDir } from '../../src/shared/dict-utils.js';
import { resolveToolingCommandProfile } from '../../src/index/tooling/command-resolver.js';
import { __testLspSessionPool } from '../../src/integrations/tooling/providers/lsp/session-pool.js';
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
 * @returns {() => void}
 */
export function prependLspTestPath(options = {}) {
  const repoRoot = options.repoRoot || process.cwd();
  const includeFixtures = options.includeFixtures !== false;
  const extraPrepend = Array.isArray(options.extraPrepend) ? options.extraPrepend : [];
  const originalPath = process.env.PATH || '';
  const toolingBin = path.join(getToolingDir(repoRoot), 'bin');
  const fixturesBin = path.join(repoRoot, 'tests', 'fixtures', 'lsp', 'bin');
  const merged = dedupePathEntries([
    ...extraPrepend,
    toolingBin,
    ...String(originalPath)
      .split(path.delimiter)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean),
    includeFixtures ? fixturesBin : ''
  ]);
  process.env.PATH = merged.join(path.delimiter);
  return () => {
    try {
      __testLspSessionPool.killAllNow();
    } catch {}
    process.env.PATH = originalPath;
  };
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
  const restorePath = prependLspTestPath(options);
  try {
    return await fn();
  } finally {
    restorePath();
  }
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
