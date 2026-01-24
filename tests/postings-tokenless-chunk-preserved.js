#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../src/index/build/state.js';

const state = createIndexState();
appendChunk(state, { file: 'empty.txt' }, {});

assert.equal(state.chunks.length, 1, 'expected tokenless chunk to be preserved');
assert.equal(state.docLengths[0], 0, 'expected doc length entry for tokenless chunk');
assert.equal(state.chunks[0].id, 0, 'expected chunk id to be assigned');

console.log('postings tokenless chunk preserved test passed');
