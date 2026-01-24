#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../src/index/build/state.js';

const state = createIndexState();
appendChunk(state, {
  tokens: ['alpha'],
  seq: ['alpha'],
  file: 'defaults.txt'
}, {}); // intentionally unnormalized

assert.ok(state.triPost.size > 0, 'expected chargrams with default config');

console.log('postings chargram config defaults test passed');
