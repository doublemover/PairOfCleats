import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { getCombinedOutput } from '../../../helpers/stdio.js';
import { getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';
import { setupIncrementalRepo } from '../../../helpers/sqlite-incremental.js';
import { runSqliteBuild } from '../../../helpers/sqlite-builder.js';
import { readBundleFile, writeBundleFile } from '../../../../src/shared/bundle-io.js';

const { root, repoRoot, env, userConfig, run } = await setupIncrementalRepo({
  name: 'bundle-partial-embeddings-fallback'
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
assert.match(output, /bundle embeddings code:/i, 'expected bundle embedding coverage diagnostics');

console.log('sqlite incremental partial bundle embeddings fallback test passed');
