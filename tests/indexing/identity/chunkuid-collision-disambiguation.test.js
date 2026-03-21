#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';

const fileRelPath = 'src/collisions.js';
const prefix = 'A'.repeat(200);
const chunkText = 'function dup() { return 1; }\n';
const suffix = 'B'.repeat(200);
const fileText = `${prefix}${chunkText}${suffix}${prefix}${chunkText}${suffix}`;

const firstStart = prefix.length;
const firstEnd = firstStart + chunkText.length;
const secondStart = firstEnd + suffix.length + prefix.length;
const secondEnd = secondStart + chunkText.length;

const chunks = [
  {
    file: fileRelPath,
    start: firstStart,
    end: firstEnd,
    kind: 'FunctionDeclaration',
    name: 'dup'
  },
  {
    file: fileRelPath,
    start: secondStart,
    end: secondEnd,
    kind: 'FunctionDeclaration',
    name: 'dup'
  }
];

await assignChunkUids({
  chunks,
  fileText,
  fileRelPath,
  strict: true
});

const [first, second] = chunks;
assert.ok(first.chunkUid && second.chunkUid, 'expected chunkUid values to be assigned');
assert.notEqual(first.chunkUid, second.chunkUid, 'expected collision disambiguation to create unique chunkUid values');
assert.equal(String(first.chunkUid).includes(':ord'), false, 'expected deterministic entropy salt to avoid ordinal fallback');
assert.equal(String(second.chunkUid).includes(':ord'), false, 'expected deterministic entropy salt to avoid ordinal fallback');
assert.equal(first.identity?.collisionOf || null, null, 'expected no ordinal collision metadata on first chunk');
assert.equal(second.identity?.collisionOf || null, null, 'expected no ordinal collision metadata on second chunk');

console.log('chunkUid collision disambiguation test passed');
