#!/usr/bin/env node

import {
  assertSparsePreflightFallback,
  prepareSparsePreflightFallbackCase
} from './sparse-preflight-fallback-helper.js';

const baseArgs = await prepareSparsePreflightFallbackCase({
  label: 'cli sqlite sparse preflight allow fallback test',
  cacheName: 'cli-sqlite-sparse-preflight-allow-fallback',
  extraArgs: []
});

await assertSparsePreflightFallback({
  baseArgs,
  failMessage: 'expected sparse-only sqlite-fts run to fail without fallback override',
  annMessage: 'expected --allow-sparse-fallback to enable ANN preflight when BM25 fallback tables are missing'
});

console.log('cli sqlite sparse preflight allow fallback test passed');
