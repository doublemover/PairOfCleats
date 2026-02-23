#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRawArgs, buildStage2Args } from '../../../src/integrations/core/args.js';

const rawFromOptions = buildRawArgs({ mode: 'all', cacheRebuild: true });
assert.ok(
  rawFromOptions.includes('--cache-rebuild'),
  'expected buildRawArgs to propagate cache-rebuild'
);

const stage2FromArgv = buildStage2Args({
  root: '/repo',
  argv: {
    mode: 'all',
    quality: null,
    threads: 8,
    incremental: false,
    sqlite: undefined,
    model: null,
    'cache-rebuild': true
  },
  rawArgv: []
});
assert.ok(
  stage2FromArgv.includes('--cache-rebuild'),
  'expected stage2 args to include cache-rebuild from parsed argv'
);

const stage2FromRaw = buildStage2Args({
  root: '/repo',
  argv: {
    mode: 'all',
    quality: null,
    threads: 8,
    incremental: false,
    sqlite: undefined,
    model: null,
    'cache-rebuild': false
  },
  rawArgv: ['--cache-rebuild']
});
assert.ok(
  stage2FromRaw.includes('--cache-rebuild'),
  'expected stage2 args to include cache-rebuild when present in raw argv'
);

const stage2WithoutCacheRebuild = buildStage2Args({
  root: '/repo',
  argv: {
    mode: 'all',
    quality: null,
    threads: 8,
    incremental: false,
    sqlite: undefined,
    model: null,
    'cache-rebuild': false
  },
  rawArgv: []
});
assert.equal(
  stage2WithoutCacheRebuild.includes('--cache-rebuild'),
  false,
  'did not expect cache-rebuild flag when disabled'
);

console.log('stage2 args cache-rebuild propagation test passed');
