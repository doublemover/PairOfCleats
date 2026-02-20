#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { isCanonicalChunkUid } from '../../../src/shared/identity.js';

// Force a collision that survives the escalation pass by ensuring the chunk span
// and both the pre/post context windows are identical (even at 1024 chars).
const fileRelPath = 'src/ordinal-collisions.js';
const pre = 'A'.repeat(2000);
const chunkText = 'function dup() { return 1; }\n';
const post = 'B'.repeat(2000);
const fileText = `${pre}${chunkText}${post}${pre}${chunkText}${post}`;

const firstStart = pre.length;
const firstEnd = firstStart + chunkText.length;
const secondStart = firstEnd + post.length + pre.length;
const secondEnd = secondStart + chunkText.length;

const firstChunk = {
  file: fileRelPath,
  start: firstStart,
  end: firstEnd,
  kind: 'FunctionDeclaration',
  name: 'dup'
};

const secondChunk = {
  file: fileRelPath,
  start: secondStart,
  end: secondEnd,
  kind: 'FunctionDeclaration',
  name: 'dup'
};

// Provide chunks out of order to ensure ordinals are assigned deterministically
// based on stable sort keys (not insertion order).
const chunks = [secondChunk, firstChunk];

const result = await assignChunkUids({
  chunks,
  fileText,
  fileRelPath,
  strict: true
});

assert.ok(result?.collisions, 'expected collision metrics');
assert.equal(result.collisions.collisionGroups, 1, 'expected one collision group in base pass');
assert.equal(result.collisions.escalated, 1, 'expected escalation to run once');
assert.equal(result.collisions.ordinal, 1, 'expected ordinal fallback to run');

assert.ok(firstChunk.chunkUid && secondChunk.chunkUid, 'expected chunkUid values to be assigned');
assert.notEqual(firstChunk.chunkUid, secondChunk.chunkUid, 'expected unique chunkUid values after ordinal disambiguation');

// Ordinal assignment should follow start offset ordering.
assert.ok(firstChunk.chunkUid.endsWith(':ord1'), 'expected earlier chunk to get :ord1');
assert.ok(secondChunk.chunkUid.endsWith(':ord2'), 'expected later chunk to get :ord2');

const firstBase = firstChunk.identity?.collisionOf || null;
const secondBase = secondChunk.identity?.collisionOf || null;
assert.ok(firstBase && secondBase, 'expected collisionOf metadata to be set');
assert.equal(firstBase, secondBase, 'expected shared collisionOf base');
assert.ok(firstChunk.chunkUid.startsWith(`${firstBase}:ord`), 'expected first uid to be derived from collisionOf base');
assert.ok(secondChunk.chunkUid.startsWith(`${secondBase}:ord`), 'expected second uid to be derived from collisionOf base');
assert.equal(isCanonicalChunkUid(firstChunk.chunkUid), true, 'expected first chunk uid to match canonical grammar');
assert.equal(isCanonicalChunkUid(secondChunk.chunkUid), true, 'expected second chunk uid to match canonical grammar');

console.log('chunkUid ordinal fallback test passed');
