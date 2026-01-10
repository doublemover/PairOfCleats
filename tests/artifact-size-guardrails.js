#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'artifact-size-guardrails');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const tokens = [];
for (let i = 0; i < 200; i += 1) {
  tokens.push(`token_${i}_${'x'.repeat(24)}`);
}
const lines = [];
for (let i = 0; i < tokens.length; i += 20) {
  lines.push(tokens.slice(i, i + 20).join(' '));
}
const content = `${lines.join('\n')}\n`;
for (let i = 0; i < 3; i += 1) {
  await fsPromises.writeFile(path.join(repoRoot, `big-${i}.js`), content);
}
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({
    sqlite: {
      use: false
    },
    indexing: {
      fileScan: {
        minified: { sampleMinBytes: 20000 }
      },
      chunkTokenMode: 'full',
      artifacts: {
        chunkMetaFormat: 'json',
        chunkMetaShardSize: 0,
        tokenPostingsFormat: 'json'
      }
    }
  }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_MAX_JSON_BYTES: '2048'
};

const result = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (result.status !== 0) {
  console.error('Failed: build_index (artifact guardrails)');
  process.exit(result.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const indexDir = getIndexDir(repoRoot, 'code', userConfig);

const chunkMetaMetaPath = path.join(indexDir, 'chunk_meta.meta.json');
const chunkMetaPartsDir = path.join(indexDir, 'chunk_meta.parts');
if (!fs.existsSync(chunkMetaMetaPath) || !fs.existsSync(chunkMetaPartsDir)) {
  console.error('Expected chunk_meta sharding when max JSON bytes is small.');
  process.exit(1);
}
if (fs.existsSync(path.join(indexDir, 'chunk_meta.json'))) {
  console.error('Expected chunk_meta.json to be suppressed when sharding.');
  process.exit(1);
}

const tokenMetaPath = path.join(indexDir, 'token_postings.meta.json');
const tokenShardsDir = path.join(indexDir, 'token_postings.shards');
if (!fs.existsSync(tokenMetaPath) || !fs.existsSync(tokenShardsDir)) {
  console.error('Expected token_postings shards when max JSON bytes is small.');
  process.exit(1);
}
if (fs.existsSync(path.join(indexDir, 'token_postings.json'))) {
  console.error('Expected token_postings.json to be suppressed when sharding.');
  process.exit(1);
}

console.log('artifact size guardrails test passed');
