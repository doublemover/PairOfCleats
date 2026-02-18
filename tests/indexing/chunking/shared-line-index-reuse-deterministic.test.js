#!/usr/bin/env node
import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking.js';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const text = [
  'message Account {',
  '  string id = 1;',
  '  string email = 2;',
  '}',
  '',
  'service UserService {',
  '  rpc GetUser(GetUserRequest) returns (GetUserResponse);',
  '  rpc PutUser(PutUserRequest) returns (PutUserResponse);',
  '}',
  '',
  'message Team {',
  '  string id = 1;',
  '  string name = 2;',
  '}'
].join('\n');

const lineIndex = buildLineIndex(text);
const context = {
  chunking: {
    maxLines: 2,
    maxBytes: 80
  },
  chunkingShared: {
    text,
    lineIndex
  }
};

const first = smartChunk({
  text,
  ext: '.proto',
  mode: 'code',
  context
});
const firstByteMetrics = context.chunkingShared.byteMetrics;

const second = smartChunk({
  text,
  ext: '.proto',
  mode: 'code',
  context
});

assert.ok(first.length > 0, 'expected proto chunking output');
assert.deepEqual(
  first.map((chunk) => ({ start: chunk.start, end: chunk.end, name: chunk.name, meta: chunk.meta })),
  second.map((chunk) => ({ start: chunk.start, end: chunk.end, name: chunk.name, meta: chunk.meta })),
  'shared line/byte index path should preserve deterministic chunk boundaries and metadata'
);
assert.ok(firstByteMetrics?.prefix instanceof Uint32Array, 'expected byte metrics cache to be populated');
assert.equal(
  context.chunkingShared.byteMetrics,
  firstByteMetrics,
  'expected byte metrics to be reused across repeated runs'
);

const cloneChunks = (chunks) => chunks.map((chunk) => ({
  ...chunk,
  meta: chunk.meta && typeof chunk.meta === 'object' ? { ...chunk.meta } : chunk.meta
}));

const assignIds = async (chunks) => {
  const cloned = cloneChunks(chunks);
  await assignChunkUids({
    chunks: cloned,
    fileText: text,
    fileRelPath: 'src/contracts/user.proto',
    namespaceKey: 'repo',
    strict: true
  });
  return cloned.map((chunk) => chunk.chunkUid);
};

const firstIds = await assignIds(first);
const secondIds = await assignIds(second);
assert.deepEqual(firstIds, secondIds, 'expected deterministic chunk IDs and ordering across repeated runs');

console.log('chunking shared line index deterministic test passed');
