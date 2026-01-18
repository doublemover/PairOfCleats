#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { MAX_JSON_BYTES, loadChunkMeta, loadTokenPostings } from '../src/shared/artifact-io.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'shard-merge');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootA = path.join(tempRoot, 'cache-a');
const cacheRootB = path.join(tempRoot, 'cache-b');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, 'lib'), { recursive: true });
await fsPromises.mkdir(cacheRootA, { recursive: true });
await fsPromises.mkdir(cacheRootB, { recursive: true });
process.env.PAIROFCLEATS_TESTING = '1';

await fsPromises.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'lib', 'beta.py'), 'def beta():\n  return 2\n');

const runBuild = (cacheRoot, label, testConfig) => {
  const env = {
    ...process.env,
    PAIROFCLEATS_TESTING: '1',
    ...(testConfig ? { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) } : {}),
    PAIROFCLEATS_CACHE_ROOT: cacheRoot,
    PAIROFCLEATS_EMBEDDINGS: 'stub'
  };
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

const readIndex = async (cacheRoot) => {
  const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
  process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
  const userConfig = loadUserConfig(repoRoot);
  const codeDir = getIndexDir(repoRoot, 'code', userConfig);
  const chunks = await loadChunkMeta(codeDir, { maxBytes: MAX_JSON_BYTES });
  const tokenIndex = loadTokenPostings(codeDir, { maxBytes: MAX_JSON_BYTES });
  if (previousCacheRoot === undefined) {
    delete process.env.PAIROFCLEATS_CACHE_ROOT;
  } else {
    process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
  }
  return { chunks, tokenIndex };
};

runBuild(cacheRootA, 'baseline build', {
  indexing: {
    fileListSampleSize: 10,
    shards: { enabled: false },
    treeSitter: { enabled: false }
  }
});
const baseline = await readIndex(cacheRootA);

runBuild(cacheRootB, 'sharded build', {
  indexing: {
    fileListSampleSize: 10,
    shards: {
      enabled: true,
      maxWorkers: 1,
      minFiles: 1
    },
    treeSitter: { enabled: false }
  }
});
const sharded = await readIndex(cacheRootB);

if (baseline.chunks.length !== sharded.chunks.length) {
  console.error('Shard merge mismatch: chunk counts differ');
  process.exit(1);
}
if (JSON.stringify(baseline.chunks) !== JSON.stringify(sharded.chunks)) {
  console.error('Shard merge mismatch: chunk metadata differs');
  process.exit(1);
}
if (JSON.stringify(baseline.tokenIndex.vocab) !== JSON.stringify(sharded.tokenIndex.vocab)) {
  console.error('Shard merge mismatch: token vocab differs');
  process.exit(1);
}
if (JSON.stringify(baseline.tokenIndex.postings) !== JSON.stringify(sharded.tokenIndex.postings)) {
  console.error('Shard merge mismatch: token postings differ');
  process.exit(1);
}

console.log('shard merge test passed');
