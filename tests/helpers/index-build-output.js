import path from 'node:path';
import { getIndexDir } from '../../tools/shared/dict-utils.js';

/**
 * Resolve this invocation's selected generation from the canonical JSON outcome.
 * Display logs and another current-build pointer cannot grant that authority.
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
  const outcome = JSON.parse(String(result?.stdout || '').trim());
  if (outcome.schemaVersion !== 1 || typeof outcome.repo !== 'string'
    || path.relative(path.resolve(repoRoot), path.resolve(outcome.repo)) !== '' || !Array.isArray(outcome.generations)) {
    throw new Error('Expected this repository\'s canonical build outcome; invoke the build with --json.');
  }
  const generation = outcome.generations.findLast(entry => typeof entry.buildRoot === 'string'
    && path.isAbsolute(entry.buildRoot) && Array.isArray(entry.modes) && entry.modes.includes(mode));
  if (!generation) throw new Error(`Build outcome has no selected ${mode} generation.`);
  return getIndexDir(repoRoot, mode, userConfig, { indexRoot: generation.buildRoot });
};
