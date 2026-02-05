#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validateChunkIds } from '../../../src/index/validate/checks.js';

const report = { issues: [], warnings: [], hints: [] };
const chunkMeta = [
  { id: 1, chunkUid: 'uid-1' },
  { id: 2, chunkUid: 'uid-2' }
];

validateChunkIds(report, 'code', chunkMeta);
assert.equal(report.issues.length, 1, 'expected docId alignment issue');
assert.ok(
  report.issues[0].includes('chunk_meta id mismatch'),
  'expected mismatch message'
);

console.log('chunk_meta id alignment guard test passed');
