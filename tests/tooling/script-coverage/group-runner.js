import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { repoRoot } from '../../helpers/root.js';
import { runNode } from '../../helpers/run-node.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = repoRoot();
const scriptCoveragePath = path.join(root, 'tests', 'tooling', 'script-coverage', 'script-coverage.runner.js');

export const runScriptCoverageGroup = (group) => {
  if (!group || typeof group !== 'string') {
    throw new Error('script coverage group is required');
  }

  const prefix = `tooling/script-coverage/${group}/`;
  const testId = process.env.PAIROFCLEATS_TEST_ID || '';
  const action = testId.startsWith(prefix) ? testId.slice(prefix.length) : '';
  const cacheRoot = resolveTestCachePath(root, 'script-coverage-groups', group, action || 'aggregate');
  const env = applyTestEnv({
    testing: '1',
    embeddings: 'stub',
    syncProcess: false,
    extraEnv: {
      PAIROFCLEATS_SCRIPT_COVERAGE_GROUPS: group,
      PAIROFCLEATS_SCRIPT_COVERAGE_CACHE_ROOT: cacheRoot
    }
  });

  const result = runNode(
    [scriptCoveragePath, '--groups', group, '--cache-root', cacheRoot, '--retries', '0',
      ...(action ? ['--action', action] : [])],
    `script coverage group ${group}`,
    root,
    env,
    { stdio: 'inherit', allowFailure: true }
  );

  if (result.status === 77) process.exit(77);
  if (result.status !== 0) {
    throw new Error(`script coverage group "${group}" failed with exit ${result.status ?? 'unknown'}`);
  }
};
