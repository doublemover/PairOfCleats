#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids, computeSegmentUid } from '../../../src/index/identity/chunk-uid.js';
import { buildToolingVirtualDocuments } from '../../../src/index/tooling/vfs.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const text = 'export const value = 1;';
const source = `${text}\n${text}`;
const segmentUid = await computeSegmentUid({ segmentText: text, segmentType: 'embedded', languageId: 'typescript' });
const chunks = [0, text.length + 1].map(start => ({ file: 'guide.md', ext: '.md', lang: 'typescript', containerLanguageId: 'markdown', start, end: start + text.length, segment: { segmentUid, segmentId: `segment-${start}`, start, end: start + text.length, languageId: 'typescript', ext: '.ts' } }));
await assignChunkUids({ chunks, fileText: source, fileRelPath: 'guide.md', strict: true });
for (const hashRouting of [false, true]) {
  const result = await buildToolingVirtualDocuments({ chunks, fileTextByPath: new Map([['guide.md', source]]), hashRouting, strict: true });
  assert.equal(result.documents.length, 2); assert.equal(result.targets.length, 2);
  assert.equal(new Set(result.documents.map(doc => doc.virtualPath)).size, 2, 'equal-text segment occurrences retain distinct routes');
  assert.equal(new Set(result.documents.map(doc => doc.docHash)).size, 1);
  assert.deepEqual(result.targets.map(target => target.virtualRange), [{ start: 0, end: text.length }, { start: 0, end: text.length }]);
}
const large = 'é'.repeat(10000), wholeChunks = Array.from({ length: 100 }, (_, id) => ({ file: 'source.ts', ext: '.ts', lang: 'typescript', start: id, end: id + 1 }));
await assignChunkUids({ chunks: wholeChunks, fileText: large, fileRelPath: 'source.ts', strict: true });
let byteScans = 0; const byteLength = Buffer.byteLength;
try {
  Buffer.byteLength = (value, ...args) => { if (value === large) byteScans += 1; return byteLength(value, ...args); };
  const result = await buildToolingVirtualDocuments({ chunks: wholeChunks, fileTextByPath: new Map([['source.ts', large]]), maxVirtualFileBytes: 30000, strict: true });
  assert.equal(result.documents.length, 1); assert.equal(result.targets.length, 100);
} finally { Buffer.byteLength = byteLength; }
assert.ok(byteScans >= 1 && byteScans <= 2, 'byte admission and any checksum byte conversion scale with documents, not targets');
