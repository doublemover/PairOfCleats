import { getCurrentBuildInfo, getIndexDir } from '../../tools/shared/dict-utils.js';

/**
 * Resolve a mode index directory from build output logs, with current-build fallback.
 *
 * @param {string} repoRoot
 * @param {object} userConfig
 * @param {{stdout?:string,stderr?:string}|null|undefined} result
 * @param {{mode?:string}} [options]
 * @returns {string}
 */
export const resolveIndexDirFromBuildResult = (
  repoRoot,
  userConfig,
  result,
  { mode = 'code' } = {}
) => {
  const output = `${result?.stderr || ''}\n${result?.stdout || ''}`;
  const buildRootMatch = output.match(/^\[init\] build root:\s*(.+)$/m);
  let indexRoot = buildRootMatch?.[1]?.trim() || null;
  if (!indexRoot) {
    const current = getCurrentBuildInfo(repoRoot, userConfig, { mode });
    indexRoot = current?.activeRoot || current?.buildRoot || null;
  }
  return getIndexDir(repoRoot, mode, userConfig, indexRoot ? { indexRoot } : {});
};
