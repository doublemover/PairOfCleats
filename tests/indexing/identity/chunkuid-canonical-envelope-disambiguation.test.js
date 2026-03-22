#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assignChunkUids } from '../../../src/index/identity/chunk-uid.js';

const fileRelPath = 'src/dart-generated.g.dart';
const chunkText = 'String serialize() => toJson();\n';
const fileText = chunkText;

const chunks = [
  {
    file: fileRelPath,
    start: 0,
    end: chunkText.length,
    kind: 'FunctionDeclaration',
    name: 'serialize'
  },
  {
    file: fileRelPath,
    start: 0,
    end: chunkText.length,
    kind: 'MethodDeclaration',
    name: 'serialize'
  }
];

const result = await assignChunkUids({
  chunks,
  fileText,
  fileRelPath,
  strict: true
});

assert.ok(result?.collisions, 'expected collision metrics');
assert.equal(result.collisions.ordinal, 0, 'expected canonical envelope disambiguation to avoid ordinal fallback');
assert.notEqual(chunks[0].chunkUid, chunks[1].chunkUid, 'expected unique chunkUid values for same-span semantic siblings');
assert.equal(chunks[0].identity?.disambiguation, 'canonical-envelope');
assert.equal(chunks[1].identity?.disambiguation, 'canonical-envelope');
assert.equal(chunks[0].identity?.mintedByStage, 'index.identity.chunk-uid.assignChunkUids');
assert.equal(chunks[1].identity?.mintedByStage, 'index.identity.chunk-uid.assignChunkUids');
assert.equal(String(chunks[0].chunkUid).includes(':ord'), false);
assert.equal(String(chunks[1].chunkUid).includes(':ord'), false);

console.log('chunkUid canonical envelope disambiguation test passed');
