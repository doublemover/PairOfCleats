import fs from 'node:fs';
import path from 'node:path';
import { getBuildsRoot, getCurrentBuildInfo, getIndexDir } from '../shared/repo-paths.js';
import { createError, ERROR_CODES } from '../shared/error-codes.js';

/**
 * Resolve the explicitly selected index or the authoritative current mode root.
 * @param {string} root
 * @param {'code'|'prose'|'records'|'extracted-prose'} mode
 * @param {object} userConfig
 * @returns {string}
 */
export function resolveIndexDir(root, mode, userConfig, options = {}) {
  const explicitDir = typeof options?.indexDirByMode?.[mode] === 'string'
    ? path.resolve(options.indexDirByMode[mode])
    : null;
  if (explicitDir) return explicitDir;
  const explicitBaseRoot = typeof options?.indexBaseRootByMode?.[mode] === 'string'
    ? path.resolve(options.indexBaseRootByMode[mode])
    : null;
  if (explicitBaseRoot) return path.join(explicitBaseRoot, `index-${mode}`);
  const hasExplicitRef = Boolean(
    options?.explicitRef === true
    && (options?.indexDirByMode || options?.indexBaseRootByMode)
  );
  if (hasExplicitRef) {
    throw createError(ERROR_CODES.NO_INDEX, `[search] ${mode} index is unavailable for explicit as-of target.`);
  }
  if (fs.existsSync(path.join(getBuildsRoot(root, userConfig), 'current.json'))) {
    const current = getCurrentBuildInfo(root, userConfig, { mode });
    if (!current?.activeRoot) {
      throw createError(ERROR_CODES.NO_INDEX, `[search] ${mode} published generation is unavailable. Repair or rebuild its current pointer.`);
    }
    return path.join(current.activeRoot, `index-${mode}`);
  }
  return getIndexDir(root, mode, userConfig);
}
