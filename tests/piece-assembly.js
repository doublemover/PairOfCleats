#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { loadChunkMeta, loadTokenPostings } from '../src/shared/artifact-io.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const buildIndexPath = path.join(root, 'build_index.js');
const assemblePath = path.join(root, 'tools', 'assemble-pieces.js');

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Missing fixture: ${fixtureRoot}`);
  process.exit(1);
}

const cacheRoot = path.join(root, 'tests', '.cache', 'piece-assembly');
const cacheA = path.join(cacheRoot, 'a');
const cacheB = path.join(cacheRoot, 'b');
const outputDir = path.join(cacheRoot, 'assembled', 'index-code');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const baseEnv = {
  ...process.env,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const run = (label, args, env) => {
  const result = spawnSync(process.execPath, args, {
    cwd: fixtureRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run('build_index (A)', [buildIndexPath, '--stub-embeddings', '--mode', 'code', '--repo', fixtureRoot], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheA
});
run('build_index (B)', [buildIndexPath, '--stub-embeddings', '--mode', 'code', '--repo', fixtureRoot], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheB
});

const userConfig = loadUserConfig(fixtureRoot);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheA;
const indexA = getIndexDir(fixtureRoot, 'code', userConfig);
process.env.PAIROFCLEATS_CACHE_ROOT = cacheB;
const indexB = getIndexDir(fixtureRoot, 'code', userConfig);

run('assemble-pieces', [
  assemblePath,
  '--repo',
  fixtureRoot,
  '--mode',
  'code',
  '--out',
  outputDir,
  '--input',
  indexA,
  '--input',
  indexB,
  '--force'
], {
  ...baseEnv,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot
});

const chunksA = loadChunkMeta(indexA).length;
const chunksB = loadChunkMeta(indexB).length;
const chunksOut = loadChunkMeta(outputDir).length;
if (chunksOut !== chunksA + chunksB) {
  console.error(`Expected merged chunk count ${chunksA + chunksB}, got ${chunksOut}`);
  process.exit(1);
}

const tokenIndex = loadTokenPostings(outputDir);
if (!Array.isArray(tokenIndex?.docLengths) || tokenIndex.docLengths.length !== chunksOut) {
  console.error('Merged token_postings docLengths mismatch.');
  process.exit(1);
}
if (!Array.isArray(tokenIndex?.vocab) || !Array.isArray(tokenIndex?.postings)) {
  console.error('Merged token_postings missing vocab/postings.');
  process.exit(1);
}
if (tokenIndex.vocab.length !== tokenIndex.postings.length) {
  console.error('Merged token_postings vocab/postings length mismatch.');
  process.exit(1);
}
let minDocId = Number.POSITIVE_INFINITY;
let maxDocId = -1;
for (const posting of tokenIndex.postings) {
  if (!Array.isArray(posting)) continue;
  for (const entry of posting) {
    if (!Array.isArray(entry)) continue;
    const docId = entry[0];
    if (!Number.isFinite(docId)) continue;
    if (docId < minDocId) minDocId = docId;
    if (docId > maxDocId) maxDocId = docId;
  }
}
if (maxDocId < chunksA || maxDocId >= chunksOut) {
  console.error('Merged token_postings docIds not offset correctly.');
  process.exit(1);
}
if (minDocId < 0) {
  console.error('Merged token_postings docIds should be non-negative.');
  process.exit(1);
}

const manifestPath = path.join(outputDir, 'pieces', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Missing pieces manifest: ${manifestPath}`);
  process.exit(1);
}

console.log('Piece assembly test passed');
