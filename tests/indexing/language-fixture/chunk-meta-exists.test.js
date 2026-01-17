#!/usr/bin/env node
import { ensureFixtureIndex, loadFixtureIndexMeta } from '../../helpers/fixture-index.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture'
});

const { chunkMeta, fileMeta, resolveChunkFile } = loadFixtureIndexMeta(fixtureRoot, userConfig);

if (!Array.isArray(chunkMeta) || chunkMeta.length === 0) {
  console.error('Language fixture chunk_meta.json missing or empty.');
  process.exit(1);
}

const sampleChunk = chunkMeta.find((chunk) => chunk && (chunk.file || chunk.fileId));
const resolvedFile = sampleChunk ? resolveChunkFile(sampleChunk) : null;
if (!resolvedFile) {
  console.error('Language fixture chunk_meta entries missing file references.');
  process.exit(1);
}

if (fileMeta && !Array.isArray(fileMeta)) {
  console.error('Language fixture file_meta.json should be an array.');
  process.exit(1);
}

console.log('Language fixture chunk metadata present.');
