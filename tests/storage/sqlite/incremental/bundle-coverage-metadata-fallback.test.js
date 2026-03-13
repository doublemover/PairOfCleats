import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getCombinedOutput } from '../../../helpers/stdio.js';
import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({
  name: 'bundle-coverage-metadata-fallback',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      treeSitter: { enabled: false }
    },
    tooling: {
      autoEnableOnDetect: false
    }
  }
});

const buildIndexPath = path.join(root, 'build_index.js');

run(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage2',
    '--no-sqlite',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage2 build',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

run(
  [
    buildIndexPath,
    '--incremental',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--stage',
    'stage3',
    '--no-sqlite',
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  'stage3 build',
  { cwd: repoRoot, env, stdio: 'inherit' }
);

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
assert.equal(fs.existsSync(manifestPath), true, 'expected incremental manifest after stage3 build');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.bundleEmbeddings, true, 'expected stage3 manifest to advertise bundle embeddings');
assert.equal(manifest.bundleEmbeddingCoverageComplete, true, 'expected stage3 manifest to start complete');

manifest.bundleEmbeddings = true;
manifest.bundleEmbeddingCoverageComplete = true;
manifest.bundleEmbeddingCoverageEligible = 1;
manifest.bundleEmbeddingCoverageCovered = 1;
manifest.bundleEmbeddingCoverageMissingFiles = 0;
manifest.bundleEmbeddingCoverageMissingChunks = 1;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const sqliteLogs = [];
await runSqliteBuild(repoRoot, {
  mode: 'code',
  incremental: true,
  logger: {
    log: (message) => sqliteLogs.push(message),
    warn: (message) => sqliteLogs.push(message),
    error: (message) => sqliteLogs.push(message)
  }
});

const output = getCombinedOutput({ stdout: sqliteLogs.join('\n'), stderr: '' });
assert.match(
  output,
  /incremental bundles skipped for code: bundle embedding coverage inconsistent .*missingChunks=1.*; using artifacts\./i
);
assert.match(output, /bundle manifest code: .*bundleEmbeddingCoverageMissingChunks=1/i);

console.log('sqlite incremental bundle coverage metadata fallback test passed');
