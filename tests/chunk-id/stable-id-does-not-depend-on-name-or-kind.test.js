#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildChunkId } from '../../src/index/chunk-id.js';

const base = {
  file: 'src/example.ts',
  segment: { segmentId: 'seg_123' },
  start: 10,
  end: 42
};

const idA = buildChunkId({ ...base, kind: 'Function', name: 'alpha' });
const idB = buildChunkId({ ...base, kind: 'Class', name: 'beta' });

assert.equal(idA, idB);

console.log('chunkId stability ok');
