#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSymbolJoinKey, resolveChunkJoinKey } from '../../../src/shared/identity.js';

const symbolA = { symbolId: 'scip:local foo', scopedId: 'sid:v1:1', symbolKey: 'sk:v1:1' };
const symbolB = { scopedId: 'sid:v1:2', symbolKey: 'sk:v1:2' };
const symbolC = { symbolKey: 'sk:v1:3' };

assert.equal(resolveSymbolJoinKey(symbolA)?.type, 'symbolId');
assert.equal(resolveSymbolJoinKey(symbolB)?.type, 'scopedId');
assert.equal(resolveSymbolJoinKey(symbolC, { allowSymbolKey: true })?.type, 'symbolKey');

const chunkA = { chunkUid: 'ck64:v1:repo:src/a.js:deadbeef', chunkId: 'chunk_dead', file: 'src/a.js', segmentUid: 'seg1' };
const chunkB = { chunkId: 'chunk_dead', file: 'src/a.js', segmentUid: 'seg1' };

assert.equal(resolveChunkJoinKey(chunkA)?.type, 'chunkUid');
assert.equal(resolveChunkJoinKey(chunkB)?.type, 'legacy');

console.log('join precedence test passed');
