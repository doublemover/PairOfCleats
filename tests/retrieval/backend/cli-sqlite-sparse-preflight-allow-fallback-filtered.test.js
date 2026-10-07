#!/usr/bin/env node

import {
  assertSparsePreflightFallback,
  prepareSparsePreflightFallbackCase
} from './sparse-preflight-fallback-helper.js';

const baseArgs = await prepareSparsePreflightFallbackCase({
  label: 'cli sqlite sparse preflight allow fallback filtered test',
  cacheName: 'cli-sqlite-sparse-preflight-allow-fallback-filtered',
  extraArgs: ['--ext', '.js']
});

await assertSparsePreflightFallback({
  baseArgs,
  failMessage: 'expected filtered sparse-only sqlite-fts run to fail without fallback override',
  annMessage: 'expected --allow-sparse-fallback to enable ANN preflight for filtered sqlite-fts route with missing BM25 tables'
});

console.log('cli sqlite sparse preflight allow fallback filtered test passed');
