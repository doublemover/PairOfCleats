#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSymbolJoinKey, resolveChunkJoinKey } from '../../../src/shared/identity.js';

const semantic = { symbolId: 'sym1:heur:abc', scopedId: 'scoped', symbolKey: 'key' };
const resolvedSemantic = resolveSymbolJoinKey(semantic);
assert.equal(resolvedSemantic?.type, 'symbolId');
assert.equal(resolvedSemantic?.key, 'sym1:heur:abc');

const nonSemantic = { symbolId: 'local:foo', scopedId: 'scoped', symbolKey: 'key' };
const resolvedNonSemantic = resolveSymbolJoinKey(nonSemantic);
assert.equal(resolvedNonSemantic?.type, 'scopedId');
assert.equal(resolvedNonSemantic?.key, 'scoped');

const allowKey = resolveSymbolJoinKey({ symbolKey: 'key' }, { allowSymbolKey: true });
assert.equal(allowKey?.type, 'symbolKey');
assert.equal(allowKey?.key, 'key');

const chunk = { chunkUid: 'ck64:v1:abc', chunkId: 'legacy', file: 'src/app.js', segmentUid: 'seg' };
assert.equal(resolveChunkJoinKey(chunk)?.type, 'chunkUid');

const legacy = { chunkId: 'legacy', file: 'src/app.js', segmentId: 'seg' };
assert.equal(resolveChunkJoinKey(legacy)?.type, 'legacy');

console.log('symbolref envelope tests passed');
