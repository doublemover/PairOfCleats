#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';

const relPath = 'src/app.ts';
const fileText = 'const a = 1;\nconst b = 2;\n';
const seg2Start = fileText.indexOf('const b');
const seg2End = fileText.length;

const chunks = [
  {
    file: relPath,
    ext: '.ts',
    lang: 'typescript',
    segment: {
      segmentUid: 'segu:v1:seg-a',
      segmentId: 'seg-a',
      languageId: 'typescript',
      ext: '.ts',
      start: 0,
      end: seg2Start
    },
    start: 0,
    end: seg2Start,
    chunkUid: 'chunk:a'
  },
  {
    file: relPath,
    ext: '.ts',
    lang: 'typescript',
    segment: {
      segmentUid: 'segu:v1:seg-b',
      segmentId: 'seg-b',
      languageId: 'typescript',
      ext: '.ts',
      start: seg2Start,
      end: seg2End
    },
    start: seg2Start,
    end: seg2End,
    chunkUid: 'chunk:b'
  }
];

const base = await buildToolingVirtualDocuments({
  chunks,
  fileTextByPath: new Map([[relPath, fileText]]),
  strict: true,
  coalesceSegments: false
});
assert.equal(base.documents.length, 2, 'expected two virtual documents without coalescing');

const coalesced = await buildToolingVirtualDocuments({
  chunks,
  fileTextByPath: new Map([[relPath, fileText]]),
  strict: true,
  coalesceSegments: true
});
assert.equal(coalesced.documents.length, 1, 'expected one virtual document with coalescing');
assert.equal(coalesced.targets.length, 2, 'expected two targets with coalescing');

const doc = coalesced.documents[0];
const targetA = coalesced.targets.find((t) => t.chunkRef?.chunkUid === 'chunk:a');
const targetB = coalesced.targets.find((t) => t.chunkRef?.chunkUid === 'chunk:b');
assert.ok(targetA && targetB, 'expected targets to map by chunkUid');
assert.equal(doc.text, fileText, 'expected coalesced doc text to match combined segments');
assert.equal(
  doc.text.slice(targetA.virtualRange.start, targetA.virtualRange.end),
  fileText.slice(0, seg2Start),
  'expected target A to map to original segment text'
);
assert.equal(
  doc.text.slice(targetB.virtualRange.start, targetB.virtualRange.end),
  fileText.slice(seg2Start, seg2End),
  'expected target B to map to original segment text'
);

console.log('VFS segment coalescing ok');
