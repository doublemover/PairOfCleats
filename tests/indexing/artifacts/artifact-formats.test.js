#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadIndex } from '../../../src/retrieval/cli-index.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'artifact-formats');

await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const writeManifest = async (pieces) => {
  const piecesDir = path.join(cacheRoot, 'pieces');
  await fs.mkdir(piecesDir, { recursive: true });
  await fs.writeFile(
    path.join(piecesDir, 'manifest.json'),
    JSON.stringify({
      version: 2,
      artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces
    }, null, 2)
  );
};

const chunkMetaLines = [
  { id: 0, file: 'src/a.js', start: 0, end: 10, ext: '.js', lang: 'javascript', kind: 'Function', name: 'alpha' },
  { id: 1, file: 'src/b.js', start: 0, end: 20, ext: '.js', lang: 'javascript', kind: 'Function', name: 'beta' }
];
const chunkMetaPartsDir = path.join(cacheRoot, 'chunk_meta.parts');
await fs.mkdir(chunkMetaPartsDir, { recursive: true });
const chunkMetaPartName = 'chunk_meta.part-00000.jsonl';
const chunkMetaPartPath = path.join(chunkMetaPartsDir, chunkMetaPartName);
await fs.writeFile(
  chunkMetaPartPath,
  `${JSON.stringify({ id: 99, file: 'src/stale.js', start: 0, end: 1, ext: '.js' })}\n`
);
const chunkMetaPartStat = await fs.stat(chunkMetaPartPath);
await fs.writeFile(
  path.join(cacheRoot, 'chunk_meta.meta.json'),
  JSON.stringify({
    schemaVersion: '0.0.1',
    artifact: 'chunk_meta',
    format: 'jsonl-sharded',
    generatedAt: new Date().toISOString(),
    compression: 'none',
    totalRecords: 1,
    totalBytes: chunkMetaPartStat.size,
    maxPartRecords: 1,
    maxPartBytes: chunkMetaPartStat.size,
    targetMaxBytes: null,
    parts: [{
      path: path.posix.join('chunk_meta.parts', chunkMetaPartName),
      records: 1,
      bytes: chunkMetaPartStat.size
    }]
  }, null, 2)
);
const staleTime = new Date(Date.now() - 5000);
await fs.utimes(path.join(chunkMetaPartsDir, chunkMetaPartName), staleTime, staleTime);
await fs.utimes(chunkMetaPartsDir, staleTime, staleTime);
await fs.utimes(path.join(cacheRoot, 'chunk_meta.meta.json'), staleTime, staleTime);
await fs.writeFile(
  path.join(cacheRoot, 'chunk_meta.jsonl'),
  `${chunkMetaLines.map((row) => JSON.stringify(row)).join('\n')}\n`
);
const freshTime = new Date(Date.now() + 5000);
await fs.utimes(path.join(cacheRoot, 'chunk_meta.jsonl'), freshTime, freshTime);
await fs.writeFile(
  path.join(cacheRoot, 'chunk_meta.json'),
  JSON.stringify([{ id: 99, file: 'src/legacy.js', start: 0, end: 1, ext: '.js' }], null, 2)
);

const shardsDir = path.join(cacheRoot, 'token_postings.shards');
await fs.mkdir(shardsDir, { recursive: true });

const partA = {
  vocab: ['alpha'],
  postings: [[[0, 1]]]
};
const partB = {
  vocab: ['beta'],
  postings: [[[1, 2]]]
};

const partAName = 'token_postings.part-00000.json';
const partBName = 'token_postings.part-00001.json';
await fs.writeFile(path.join(shardsDir, partAName), JSON.stringify(partA, null, 2));
await fs.writeFile(path.join(shardsDir, partBName), JSON.stringify(partB, null, 2));

const meta = {
  avgDocLen: 1.5,
  totalDocs: 2,
  format: 'sharded',
  shardSize: 1,
  vocabCount: 2,
  parts: [
    path.posix.join('token_postings.shards', partAName),
    path.posix.join('token_postings.shards', partBName)
  ],
  docLengths: [1, 2]
};
await fs.writeFile(
  path.join(cacheRoot, 'token_postings.meta.json'),
  JSON.stringify(meta, null, 2)
);
await fs.writeFile(
  path.join(cacheRoot, 'token_postings.json'),
  JSON.stringify({ vocab: ['legacy'], postings: [[[0, 1]]], docLengths: [1], avgDocLen: 1, totalDocs: 1 }, null, 2)
);

await writeManifest([
  { name: 'chunk_meta', path: 'chunk_meta.jsonl', format: 'jsonl' },
  { name: 'token_postings', path: path.posix.join('token_postings.shards', partAName), format: 'json' },
  { name: 'token_postings', path: path.posix.join('token_postings.shards', partBName), format: 'json' },
  { name: 'token_postings_meta', path: 'token_postings.meta.json', format: 'json' }
]);

const idx = await loadIndex(cacheRoot, { modelIdDefault: null, fileChargramN: 3 });

if (!idx || !Array.isArray(idx.chunkMeta) || idx.chunkMeta.length !== 2) {
  console.error('Expected chunk_meta to load from JSONL.');
  process.exit(1);
}
if (!idx.tokenIndex || idx.tokenIndex.vocab?.length !== 2) {
  console.error('Expected token_postings shards to load into tokenIndex.');
  process.exit(1);
}
if (!Array.isArray(idx.tokenIndex.docLengths) || idx.tokenIndex.docLengths.length !== 2) {
  console.error('Expected docLengths to load from token_postings meta.');
  process.exit(1);
}

console.log('artifact formats test passed');

