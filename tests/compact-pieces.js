#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'compact-pieces');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const buildIndexPath = path.join(root, 'build_index.js');
const compactPiecesPath = path.join(root, 'tools', 'compact-pieces.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'const beta = 2;\n');
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({
    indexing: {
      treeSitter: { enabled: false },
      artifacts: {
        chunkMetaFormat: 'jsonl',
        chunkMetaShardSize: 1,
        tokenPostingsFormat: 'sharded',
        tokenPostingsShardSize: 1
      }
    }
  }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runNode = (label, args, cwd = repoRoot) => {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [buildIndexPath, '--stub-embeddings', '--mode', 'code', '--repo', repoRoot]);

const userConfig = loadUserConfig(repoRoot);
const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
if (previousCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
}
const chunkPartsDir = path.join(indexDir, 'chunk_meta.parts');
const tokenPartsDir = path.join(indexDir, 'token_postings.shards');
const beforeChunkParts = fs.existsSync(chunkPartsDir) ? fs.readdirSync(chunkPartsDir).length : 0;
const beforeTokenParts = fs.existsSync(tokenPartsDir) ? fs.readdirSync(tokenPartsDir).length : 0;
if (beforeChunkParts < 2) {
  console.error('Expected multiple chunk_meta parts before compaction.');
  process.exit(1);
}

runNode('compact-pieces', [
  compactPiecesPath,
  '--repo',
  repoRoot,
  '--mode',
  'code',
  '--chunk-meta-size',
  '10',
  '--token-postings-size',
  '10'
]);

const afterChunkParts = fs.existsSync(chunkPartsDir) ? fs.readdirSync(chunkPartsDir).length : 0;
const afterTokenParts = fs.existsSync(tokenPartsDir) ? fs.readdirSync(tokenPartsDir).length : 0;
if (afterChunkParts >= beforeChunkParts) {
  console.error('Expected chunk_meta parts to shrink after compaction.');
  process.exit(1);
}
if (beforeTokenParts >= 2 && afterTokenParts >= beforeTokenParts) {
  console.error('Expected token_postings shards to shrink after compaction.');
  process.exit(1);
}

const logPath = path.join(indexDir, 'pieces', 'compaction.log');
if (!fs.existsSync(logPath)) {
  console.error(`Expected compaction log at ${logPath}`);
  process.exit(1);
}

console.log('compact pieces test passed');
