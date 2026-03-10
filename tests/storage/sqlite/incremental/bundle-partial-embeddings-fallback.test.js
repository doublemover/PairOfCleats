import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getCombinedOutput } from '../../../helpers/stdio.js';
import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { readBundleFile, writeBundleFile } from '../../../../src/shared/bundle-io.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({
  name: 'bundle-partial-embeddings-fallback',
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
assert.equal(manifest.bundleEmbeddingCoverageComplete, true, 'expected stage3 manifest coverage to start complete');

const [targetFile, targetEntry] = Object.entries(manifest.files || {}).find(([, entry]) => Array.isArray(entry?.bundles) && entry.bundles.length)
  || [];
assert.ok(targetFile && targetEntry, 'expected a manifest file entry with bundle shards');

const bundleName = targetEntry.bundles[0];
const bundlePath = path.join(repoCacheRoot, 'incremental', 'code', 'files', bundleName);
const readResult = await readBundleFile(bundlePath, { format: targetEntry.bundleFormat || null });
assert.equal(readResult.ok, true, `expected readable bundle before mutation: ${readResult.reason || 'unknown error'}`);

const mutatedChunks = (readResult.bundle.chunks || []).map((chunk) => ({
  ...chunk,
  embedding: null,
  embedding_u8: null
}));
await writeBundleFile({
  bundlePath,
  format: targetEntry.bundleFormat || null,
  bundle: {
    ...readResult.bundle,
    chunks: mutatedChunks
  }
});

manifest.bundleEmbeddings = false;
manifest.bundleEmbeddingCoverageComplete = false;
manifest.bundleEmbeddingCoverageEligible = 1;
manifest.bundleEmbeddingCoverageCovered = 0;
manifest.bundleEmbeddingCoverageMissingFiles = 1;
manifest.bundleEmbeddingCoverageMissingChunks = mutatedChunks.length;
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
assert.match(output, /incremental bundles skipped for code: bundles omit embeddings .*coverage incomplete; using artifacts\./i);

const manifestAfter = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifestAfter.bundleEmbeddings, false, 'expected partial coverage to fail closed in manifest');
assert.equal(manifestAfter.bundleEmbeddingCoverageComplete, false, 'expected manifest to record incomplete embedding coverage');
assert.equal(manifestAfter.bundleEmbeddingCoverageMissingFiles, 1, 'expected manifest to record missing file coverage');
assert.equal(
  manifestAfter.bundleEmbeddingCoverageMissingChunks,
  mutatedChunks.length,
  'expected manifest to record missing chunk coverage'
);

console.log('sqlite incremental partial bundle embeddings fallback test passed');
