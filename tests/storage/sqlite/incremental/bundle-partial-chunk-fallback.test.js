import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getCombinedOutput } from '../../../helpers/stdio.js';
import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { readBundleFile, writeBundleFile } from '../../../../src/shared/bundle-io.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({
  name: 'bundle-partial-chunk-fallback',
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

const largeSourcePath = path.join(repoRoot, 'src', 'multi-chunk.js');
fs.mkdirSync(path.dirname(largeSourcePath), { recursive: true });
fs.writeFileSync(
  largeSourcePath,
  Array.from({ length: 256 }, (_, index) => `export function value${index}() { return ${index}; }`).join('\n'),
  'utf8'
);

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

const [targetFile, targetEntry] = Object.entries(manifest.files || {}).find(([file, entry]) => (
  file === 'src/multi-chunk.js'
  && Array.isArray(entry?.bundles)
  && entry.bundles.length
))
  || [];
assert.ok(targetFile && targetEntry, 'expected a manifest file entry with bundle shards');

const bundleName = targetEntry.bundles[0];
const bundlePath = path.join(repoCacheRoot, 'incremental', 'code', 'files', bundleName);
const readResult = await readBundleFile(bundlePath, { format: targetEntry.bundleFormat || null });
assert.equal(readResult.ok, true, `expected readable bundle before mutation: ${readResult.reason || 'unknown error'}`);
assert.ok(Array.isArray(readResult.bundle?.chunks) && readResult.bundle.chunks.length > 1, 'expected multi-chunk bundle before mutation');

const mutatedChunks = readResult.bundle.chunks.map((chunk, index) => (
  index === 0
    ? {
      ...chunk,
      embedding: null,
      embedding_u8: null
    }
    : chunk
));
await writeBundleFile({
  bundlePath,
  format: targetEntry.bundleFormat || null,
  bundle: {
    ...readResult.bundle,
    chunks: mutatedChunks
  }
});

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
assert.match(output, /incremental bundle build failed for code: bundles missing embeddings; using artifacts\./i);
assert.match(output, /bundle embeddings code: .*partial 1.*missingChunks=1.*sample missing:/i);

console.log('sqlite incremental partial chunk fallback test passed');
