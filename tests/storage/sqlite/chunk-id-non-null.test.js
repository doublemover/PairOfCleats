#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildChunkRow } from '../../../src/storage/sqlite/build-helpers.js';

const row = buildChunkRow(
  {
    file: 'src/a.js',
    start: 0,
    end: 4,
    tokens: ['a']
  },
  'code',
  0
);

assert.ok(row.chunk_id, 'expected chunk_id to be populated');

console.log('sqlite chunk_id non-null guard ok');
