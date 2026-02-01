#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';

const root = process.cwd();
const cacheRoot = path.join(root, '.testCache', 'artifact-size-guardrails');
const repoRoot = path.join(cacheRoot, 'repo');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const tokens = [];
for (let i = 0; i < 200; i += 1) {
  tokens.push(`token_${i}_${'x'.repeat(24)}`);
}
const lines = [];
for (let i = 0; i < tokens.length; i += 5) {
  lines.push(tokens.slice(i, i + 5).join(' '));
}
const content = `${lines.join('\n')}\n`;
const fileCount = 12;
for (let i = 0; i < fileCount; i += 1) {
  await fsPromises.writeFile(path.join(repoRoot, `big-${i}.js`), content);
}

const baseEnv = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_WORKER_POOL: 'off'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const maxJsonBytes = 16384;
const smallMaxConfig = {
  indexing: {
    postings: {
      fielded: false
    }
  }
};
const runBuild = (label, envOverrides) => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'build_index.js'),
      '--stub-embeddings',
      '--mode',
      'code',
      '--stage',
      'stage1',
      '--repo',
      repoRoot
    ],
    { cwd: repoRoot, env: { ...baseEnv, ...envOverrides }, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(`Failed: build_index (${label})`);
    process.exit(result.status ?? 1);
  }
};

runBuild('artifact guardrails (small max)', {
  PAIROFCLEATS_TEST_MAX_JSON_BYTES: String(maxJsonBytes),
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify(smallMaxConfig)
});

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
const partFiles = fs.readdirSync(chunkMetaPartsDir)
  .filter((name) => name.startsWith('chunk_meta.part-'));
if (!partFiles.length) {
  console.error('Expected chunk_meta parts to be present when sharding.');
  process.exit(1);
}
for (const partName of partFiles) {
  const partPath = path.join(chunkMetaPartsDir, partName);
  const stat = fs.statSync(partPath);
  if (stat.size > maxJsonBytes) {
    console.error(`chunk_meta part exceeds max JSON bytes (${stat.size} > ${maxJsonBytes}): ${partName}`);
    process.exit(1);
  }
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

const jsonlShardConfig = {
  indexing: {
    artifacts: {
      chunkMetaFormat: 'jsonl',
      chunkMetaShardSize: 1
    }
  }
};
runBuild('chunk meta jsonl shards', {
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify(jsonlShardConfig)
});
const jsonlShardIndexDir = getIndexDir(repoRoot, 'code', userConfig);
const jsonlMetaPath = path.join(jsonlShardIndexDir, 'chunk_meta.meta.json');
const jsonlPartsDir = path.join(jsonlShardIndexDir, 'chunk_meta.parts');
const jsonlPath = path.join(jsonlShardIndexDir, 'chunk_meta.jsonl');
if (!fs.existsSync(jsonlMetaPath) || !fs.existsSync(jsonlPartsDir)) {
  console.error('Expected chunk_meta jsonl sharding artifacts with chunkMetaFormat=jsonl.');
  process.exit(1);
}
if (fs.existsSync(jsonlPath)) {
  console.error('Expected chunk_meta.jsonl to be removed when jsonl sharding is enabled.');
  process.exit(1);
}

const jsonlFlatConfig = {
  indexing: {
    artifacts: {
      chunkMetaFormat: 'jsonl',
      chunkMetaShardSize: 100000
    }
  }
};
runBuild('chunk meta jsonl unsharded', {
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify(jsonlFlatConfig)
});
const jsonlFlatIndexDir = getIndexDir(repoRoot, 'code', userConfig);
const jsonlFlatPath = path.join(jsonlFlatIndexDir, 'chunk_meta.jsonl');
if (!fs.existsSync(jsonlFlatPath)) {
  console.error('Expected chunk_meta.jsonl for unsharded jsonl output.');
  process.exit(1);
}
if (fs.existsSync(path.join(jsonlFlatIndexDir, 'chunk_meta.meta.json'))
  || fs.existsSync(path.join(jsonlFlatIndexDir, 'chunk_meta.parts'))) {
  console.error('Expected jsonl shard artifacts to be cleaned up when switching to unsharded jsonl.');
  process.exit(1);
}
if (fs.existsSync(path.join(jsonlFlatIndexDir, 'chunk_meta.json'))) {
  console.error('Expected chunk_meta.json to be removed when chunkMetaFormat=jsonl is used.');
  process.exit(1);
}

runBuild('artifact guardrails (large max)', { PAIROFCLEATS_TEST_MAX_JSON_BYTES: '52428800' });

const nextIndexDir = getIndexDir(repoRoot, 'code', userConfig);
const nextChunkMetaMeta = path.join(nextIndexDir, 'chunk_meta.meta.json');
const nextChunkMetaParts = path.join(nextIndexDir, 'chunk_meta.parts');
if (fs.existsSync(nextChunkMetaMeta) || fs.existsSync(nextChunkMetaParts)) {
  console.error('Expected chunk_meta to remain unsharded when max JSON bytes is large.');
  process.exit(1);
}
if (!fs.existsSync(path.join(nextIndexDir, 'chunk_meta.json'))) {
  console.error('Expected chunk_meta.json when max JSON bytes is large.');
  process.exit(1);
}

const nextTokenMetaPath = path.join(nextIndexDir, 'token_postings.meta.json');
const nextTokenShardsDir = path.join(nextIndexDir, 'token_postings.shards');
if (fs.existsSync(nextTokenMetaPath) || fs.existsSync(nextTokenShardsDir)) {
  console.error('Expected token_postings to remain unsharded when max JSON bytes is large.');
  process.exit(1);
}
if (!fs.existsSync(path.join(nextIndexDir, 'token_postings.json'))) {
  console.error('Expected token_postings.json when max JSON bytes is large.');
  process.exit(1);
}

console.log('artifact size guardrails test passed');

