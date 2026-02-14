#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyQuery } from '../../../src/retrieval/query-intent.js';

const pathIntent = classifyQuery({
  query: 'src/utils/file.ts',
  tokens: ['src/utils/file.ts'],
  phrases: []
});
assert.equal(pathIntent.type, 'path', 'expected explicit file path to classify as path intent');

const windowsPathIntent = classifyQuery({
  query: 'C:\\repo\\src\\index.js',
  tokens: ['C:\\repo\\src\\index.js'],
  phrases: []
});
assert.equal(windowsPathIntent.type, 'path', 'expected windows path to classify as path intent');

const urlIntent = classifyQuery({
  query: 'https://example.com/docs/api',
  tokens: ['https://example.com/docs/api'],
  phrases: []
});
assert.equal(urlIntent.type, 'url', 'expected URL intent classification');
assert.equal(urlIntent.signals.hasUrl, true, 'expected URL signal');
assert.equal(urlIntent.signals.hasPath, false, 'expected URL to avoid path classification');

const slashOnly = classifyQuery({
  query: 'feature/flag',
  tokens: ['feature/flag'],
  phrases: []
});
assert.notEqual(slashOnly.type, 'path', 'expected slash-only token to avoid implicit path intent');

console.log('query intent path heuristics test passed');
