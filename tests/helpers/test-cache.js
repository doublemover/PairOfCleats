import { resolveDevelopmentArtifactPath } from '../../tools/shared/dev-artifacts.js';
import fsPromises from 'node:fs/promises';

const VALID_TEST_CACHE_SCOPES = new Set(['isolated', 'shared']);

export const normalizeTestLane = (lane = process.env.PAIROFCLEATS_TEST_LANE) => (
  String(lane || '').trim().toLowerCase()
);

export const resolveDefaultTestCacheScope = (lane = process.env.PAIROFCLEATS_TEST_LANE) => {
  const normalized = normalizeTestLane(lane);
  if (normalized === 'ci' || normalized === 'ci-long') return 'shared';
  return 'isolated';
};

export const resolveDefaultTestBuildStage = (lane = process.env.PAIROFCLEATS_TEST_LANE) => {
  const normalized = normalizeTestLane(lane);
  if (normalized === 'ci' || normalized === 'ci-long') return 'stage2';
  return null;
};

export const resolveDefaultTestConfigLane = (lane = process.env.PAIROFCLEATS_TEST_LANE) => {
  const normalized = String(lane || '').trim().toLowerCase();
  if (normalized === 'ci' || normalized === 'ci-long') return normalized;
  return '';
};

export const resolveTestCacheDir = (name, { root = process.cwd() } = {}) => {
  const label = typeof name === 'string' && name.trim() ? name.trim() : 'default';
  return {
    root,
    dir: resolveDevelopmentArtifactPath(root, 'test-cache', label)
  };
};

export const resolveTestCachePath = (root = process.cwd(), ...segments) => (
  resolveDevelopmentArtifactPath(root, 'test-cache', ...segments)
);

export const normalizeTestCacheScope = (cacheScope, {
  defaultScope = 'isolated'
} = {}) => {
  const normalized = String(cacheScope || defaultScope).trim().toLowerCase();
  if (!VALID_TEST_CACHE_SCOPES.has(normalized)) {
    throw new Error(`Unsupported cacheScope: ${cacheScope}`);
  }
  return normalized;
};

export const prepareTestCacheDir = async (name, { clean = true, root = process.cwd() } = {}) => {
  const resolved = resolveTestCacheDir(name, { root });
  if (clean) {
    await fsPromises.rm(resolved.dir, { recursive: true, force: true });
  }
  await fsPromises.mkdir(resolved.dir, { recursive: true });
  return resolved;
};

/**
 * Prepare a uniquely-named isolated directory under `temp/dev/tests/cache`.
 *
 * @param {string} baseName
 * @param {{root?:string,clean?:boolean}} [options]
 * @returns {Promise<{root:string,dir:string}>}
 */
export const prepareIsolatedTestCacheDir = async (
  baseName,
  { root = process.cwd(), clean = true } = {}
) => {
  const prefix = String(baseName || 'isolated-test-cache').trim() || 'isolated-test-cache';
  const unique = `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prepareTestCacheDir(unique, { root, clean });
};
