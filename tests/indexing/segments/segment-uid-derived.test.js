#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignSegmentUids, discoverSegments } from '../../../src/index/segments.js';

const text = [
  '# Guide',
  '',
  '```ts',
  'export const value = 42;',
  '```',
  ''
].join('\n');
const relPath = 'docs/guide.md';

const buildUid = async () => {
  const segments = discoverSegments({
    text,
    ext: '.md',
    relPath,
    mode: 'prose',
    segmentsConfig: { inlineCodeSpans: false }
  });
  await assignSegmentUids({ text, segments, ext: '.md', mode: 'prose' });
  const target = segments.find((segment) => segment.languageId === 'typescript');
  return target?.segmentUid || null;
};

const uidA = await buildUid();
const uidB = await buildUid();

assert.ok(uidA && uidA.startsWith('segu:v1:'), 'Expected segmentUid to be derived.');
assert.equal(uidA, uidB, 'Expected segmentUid derivation to be deterministic.');

console.log('segmentUid derivation ok');
