#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids, computeSegmentUid } from '../../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';

const relPath = 'docs/guide.md';
const fileText = [
  'Intro',
  '```ts',
  'const foo = 1;',
  'console.log(foo);',
  '```',
  'Outro'
].join('\n');

const fenceStart = fileText.indexOf('```ts');
const segmentStart = fileText.indexOf('\n', fenceStart) + 1;
const segmentEnd = fileText.indexOf('```', segmentStart);
const segmentText = fileText.slice(segmentStart, segmentEnd);
const segmentUid = await computeSegmentUid({
  segmentText,
  segmentType: 'embedded',
  languageId: 'typescript'
});

const chunkText = 'const foo = 1;';
const chunkStart = fileText.indexOf(chunkText, segmentStart);
const chunkEnd = chunkStart + chunkText.length;

const chunk = {
  file: relPath,
  ext: '.md',
  lang: 'typescript',
  segment: {
    segmentUid,
    segmentId: 'seg-1',
    languageId: 'typescript',
    ext: '.ts',
    start: segmentStart,
    end: segmentEnd
  },
  start: chunkStart,
  end: chunkEnd,
  name: 'foo',
  kind: 'VariableDeclaration'
};

await assignChunkUids({ chunks: [chunk], fileText, fileRelPath: relPath, strict: true });

const { documents, targets } = await buildToolingVirtualDocuments({
  chunks: [chunk],
  fileTextByPath: new Map([[relPath, fileText]]),
  strict: true
});

assert.equal(documents.length, 1, 'expected one virtual document');
assert.equal(targets.length, 1, 'expected one tooling target');
const doc = documents[0];
const target = targets[0];
const virtualSlice = doc.text.slice(target.virtualRange.start, target.virtualRange.end);
const originalSlice = fileText.slice(chunk.start, chunk.end);
assert.equal(virtualSlice, originalSlice, 'expected virtualRange to map to original chunk text');

console.log('VFS segment offset mapping test passed');
