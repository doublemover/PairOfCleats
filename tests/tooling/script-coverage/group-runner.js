import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';

const root = repoRoot();
const scriptCoveragePath = path.join(root, 'tests', 'tooling', 'script-coverage', 'script-coverage.runner.js');

export const runScriptCoverageGroup = (group) => {
  if (!group || typeof group !== 'string') {
    throw new Error('script coverage group is required');
  }

  const cacheRoot = path.join(root, '.testCache', 'script-coverage-groups', group);
  const env = applyTestEnv({
    testing: '1',
    embeddings: 'stub',
    extraEnv: {
      PAIROFCLEATS_SCRIPT_COVERAGE_GROUPS: group,
      PAIROFCLEATS_SCRIPT_COVERAGE_CACHE_ROOT: cacheRoot
    }
  });

  const result = spawnSync(
    process.execPath,
    [scriptCoveragePath, '--groups', group, '--cache-root', cacheRoot],
    { cwd: root, env, stdio: 'inherit' }
  );

  if (result.status !== 0) {
    throw new Error(`script coverage group "${group}" failed with exit ${result.status ?? 'unknown'}`);
  }
};
