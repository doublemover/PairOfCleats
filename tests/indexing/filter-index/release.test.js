#!/usr/bin/env node
import { buildFilterIndex, releaseFilterIndexMemory } from '../../../src/retrieval/filter-index.js';

const chunks = [
  {
    id: 0,
    file: 'src/app.js',
    ext: '.js',
    lang: 'javascript',
    kind: 'FunctionDeclaration',
    last_author: 'alice',
    docmeta: { visibility: 'public' },
    chunk_authors: ['alice', 'bob'],
    metaV2: { lang: 'javascript' }
  },
  {
    id: 1,
    file: 'src/util.js',
    ext: '.js',
    lang: 'javascript',
    kind: 'VariableDeclaration',
    last_author: 'bob',
    docmeta: { visibility: 'private' },
    chunk_authors: ['bob'],
    metaV2: { lang: 'javascript' }
  }
];

const index = buildFilterIndex(chunks, { fileChargramN: 3, includeBitmaps: false });
if (!index.byExt || index.byExt.size === 0) {
  console.error('filter index release test failed: expected populated index.');
  process.exit(1);
}

releaseFilterIndexMemory(index);

const mapSizes = [
  index.byExt,
  index.byLang,
  index.byKind,
  index.byAuthor,
  index.byChunkAuthor,
  index.byVisibility,
  index.fileChargrams
].map((map) => (map && typeof map.size === 'number' ? map.size : 0));

if (mapSizes.some((size) => size !== 0)) {
  console.error('filter index release test failed: expected maps to be cleared.');
  process.exit(1);
}
if (Array.isArray(index.fileById) && index.fileById.length !== 0) {
  console.error('filter index release test failed: expected fileById cleared.');
  process.exit(1);
}
if (Array.isArray(index.fileChunksById) && index.fileChunksById.length !== 0) {
  console.error('filter index release test failed: expected fileChunksById cleared.');
  process.exit(1);
}
if (index.fileIdByPath && typeof index.fileIdByPath.size === 'number' && index.fileIdByPath.size !== 0) {
  console.error('filter index release test failed: expected fileIdByPath cleared.');
  process.exit(1);
}

console.log('filter index release test passed');
