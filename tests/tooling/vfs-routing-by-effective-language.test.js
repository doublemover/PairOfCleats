#!/usr/bin/env node
import assert from 'node:assert/strict';
import { discoverSegments, assignSegmentUids, chunkSegments } from '../../src/index/segments.js';
import { assignChunkUids } from '../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments } from '../../src/index/tooling/vfs.js';

const relPath = 'src/App.vue';
const text = [
  '<template>',
  '  <div>{{ msg }}</div>',
  '</template>',
  '<script lang="ts">',
  'export const msg: string = "hi";',
  '</script>'
].join('\n');

let segments = discoverSegments({
  text,
  ext: '.vue',
  relPath,
  mode: 'code',
  languageId: 'vue'
});
segments = await assignSegmentUids({ text, segments, ext: '.vue', mode: 'code' });

const chunks = chunkSegments({
  text,
  ext: '.vue',
  relPath,
  mode: 'code',
  segments
});
for (const chunk of chunks) {
  chunk.file = relPath;
}

await assignChunkUids({ chunks, fileText: text, fileRelPath: relPath, strict: true });

const { documents } = await buildToolingVirtualDocuments({
  chunks,
  fileTextByPath: new Map([[relPath, text]]),
  strict: true
});

const tsDocs = documents.filter((doc) => doc.effectiveExt === '.ts');
assert.equal(tsDocs.length, 1, 'expected exactly one TypeScript virtual document');
assert.equal(tsDocs[0].languageId, 'typescript');

console.log('VFS routing by effective language test passed');
