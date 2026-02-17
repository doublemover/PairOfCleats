#!/usr/bin/env node
import assert from 'node:assert/strict';
import { configureOutputCaches, getFormatShortCache } from '../../../src/retrieval/output/cache.js';
import { formatShortChunk } from '../../../src/retrieval/output/format.js';
import { color } from '../../../src/retrieval/cli/ansi.js';

applyTestEnv();

configureOutputCaches({ cacheConfig: {} });
const cache = getFormatShortCache();
const initialHits = cache?.stats?.hits || 0;

const chunk = {
  file: 'src/a.js',
  start: 0,
  end: 5,
  startLine: 1,
  endLine: 1,
  name: 'alpha',
  kind: 'Function',
  headline: 'alpha beta'
};

formatShortChunk({
  chunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'bm25',
  explain: false,
  color,
  queryTokens: ['alpha'],
  rx: /alpha/g,
  matched: true
});

formatShortChunk({
  chunk,
  index: 0,
  mode: 'code',
  score: 1,
  scoreType: 'bm25',
  explain: false,
  color,
  queryTokens: ['alpha'],
  rx: /alpha/g,
  matched: true
});

const finalHits = cache?.stats?.hits || 0;
assert.ok(finalHits > initialHits, 'expected format cache hit');

console.log('output cache hit test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
