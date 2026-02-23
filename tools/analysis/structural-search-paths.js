import fs from 'node:fs';
import path from 'node:path';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { joinPathSafe } from '../../src/shared/path-normalize.js';

/**
 * Resolve a structural rule path while enforcing registry-root containment.
 *
 * - Absolute paths are allowed when they exist.
 * - Paths prefixed with `rules/` are resolved relative to `registryRepoRoot`.
 * - All other relative paths are resolved relative to `registryDir`.
 *
 * @param {{
 *   rulePath:string,
 *   registryRepoRoot:string,
 *   registryDir:string
 * }} input
 * @returns {string|null}
 */
export const resolveRulePathSafe = ({ rulePath, registryRepoRoot, registryDir }) => {
  const candidate = String(rulePath || '').trim();
  if (!candidate) return null;
  if (isAbsolutePathNative(candidate)) {
    const absoluteCandidate = path.resolve(candidate);
    return fs.existsSync(absoluteCandidate) ? absoluteCandidate : null;
  }
  const normalized = candidate.replace(/\\/g, '/');
  const baseDir = normalized.startsWith('rules/') ? registryRepoRoot : registryDir;
  const resolved = joinPathSafe(baseDir, [candidate]);
  if (!resolved) return null;
  return fs.existsSync(resolved) ? resolved : null;
};
