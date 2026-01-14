#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadIndex } from '../src/retrieval/cli-index.js';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'artifact-formats');

await fs.rm(cacheRoot, { recursive: true, force: true });
await fs.mkdir(cacheRoot, { recursive: true });

const chunkMetaLines = [
  { id: 0, file: 'src/a.js', start: 0, end: 10, ext: '.js', kind: 'Function', name: 'alpha' },
  { id: 1, file: 'src/b.js', start: 0, end: 20, ext: '.js', kind: 'Function', name: 'beta' }
];
await fs.writeFile(
  path.join(cacheRoot, 'chunk_meta.jsonl'),
  `${chunkMetaLines.map((row) => JSON.stringify(row)).join('\n')}\n`
);
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
    path.join('token_postings.shards', partAName),
    path.join('token_postings.shards', partBName)
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
