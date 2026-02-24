#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRawArgs, buildStage2Args } from '../../../src/integrations/core/args.js';

const rawFromOptions = buildRawArgs({ mode: 'all', cacheRebuild: true });
assert.ok(
  rawFromOptions.includes('--cache-rebuild'),
  'expected buildRawArgs to propagate cache-rebuild'
);

const rawSchedulerAndScm = buildRawArgs({
  stage: 'stage2',
  scheduler: false,
  schedulerLowResource: true,
  schedulerCpu: 5,
  schedulerIo: 7,
  schedulerMem: 3,
  schedulerStarvation: 18000,
  scmAnnotate: true,
  dims: 1536,
  sqliteBatchSize: 2048,
  scmProvider: 'git'
});
assert.ok(rawSchedulerAndScm.includes('--no-scheduler'), 'expected --no-scheduler flag');
assert.ok(rawSchedulerAndScm.includes('--scheduler-low-resource'), 'expected --scheduler-low-resource flag');
assert.ok(rawSchedulerAndScm.includes('--scheduler-cpu'), 'expected --scheduler-cpu flag');
assert.ok(rawSchedulerAndScm.includes('--scheduler-io'), 'expected --scheduler-io flag');
assert.ok(rawSchedulerAndScm.includes('--scheduler-mem'), 'expected --scheduler-mem flag');
assert.ok(rawSchedulerAndScm.includes('--scheduler-starvation'), 'expected --scheduler-starvation flag');
assert.ok(rawSchedulerAndScm.includes('--scm-annotate'), 'expected --scm-annotate flag');
assert.ok(rawSchedulerAndScm.includes('--dims'), 'expected --dims flag');
assert.ok(rawSchedulerAndScm.includes('--sqlite-batch-size'), 'expected --sqlite-batch-size flag');
assert.ok(rawSchedulerAndScm.includes('--scm-provider'), 'expected --scm-provider flag');

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

const stage2Forwarded = buildStage2Args({
  root: '/repo',
  argv: {
    mode: 'all',
    quality: null,
    threads: 8,
    incremental: false,
    sqlite: true,
    model: null,
    dims: 1024,
    scheduler: false,
    schedulerLowResource: true,
    schedulerCpu: 6,
    schedulerIo: 5,
    schedulerMem: 4,
    schedulerStarvation: 19000,
    scmAnnotate: false,
    scmProvider: 'git',
    sqliteBatchSize: 512
  },
  rawArgv: [
    '--dims',
    '1024',
    '--no-scheduler',
    '--scheduler-low-resource',
    '--scheduler-cpu',
    '6',
    '--scheduler-io',
    '5',
    '--scheduler-mem',
    '4',
    '--scheduler-starvation',
    '19000',
    '--no-scm-annotate',
    '--sqlite-batch-size',
    '512',
    '--scm-provider',
    'git'
  ]
});
assert.ok(stage2Forwarded.includes('--dims'), 'expected stage2 --dims forwarding');
assert.ok(stage2Forwarded.includes('--no-scheduler'), 'expected stage2 --no-scheduler forwarding');
assert.ok(stage2Forwarded.includes('--scheduler-low-resource'), 'expected stage2 --scheduler-low-resource forwarding');
assert.ok(stage2Forwarded.includes('--scheduler-cpu'), 'expected stage2 --scheduler-cpu forwarding');
assert.ok(stage2Forwarded.includes('--scheduler-io'), 'expected stage2 --scheduler-io forwarding');
assert.ok(stage2Forwarded.includes('--scheduler-mem'), 'expected stage2 --scheduler-mem forwarding');
assert.ok(stage2Forwarded.includes('--scheduler-starvation'), 'expected stage2 --scheduler-starvation forwarding');
assert.ok(stage2Forwarded.includes('--no-scm-annotate'), 'expected stage2 --no-scm-annotate forwarding');
assert.ok(stage2Forwarded.includes('--sqlite-batch-size'), 'expected stage2 --sqlite-batch-size forwarding');
assert.ok(stage2Forwarded.includes('--scm-provider'), 'expected stage2 --scm-provider forwarding');

const stage2RawFallback = buildStage2Args({
  root: '/repo',
  argv: {
    mode: 'all',
    quality: null,
    threads: 8,
    incremental: false,
    sqlite: undefined,
    model: null
  },
  rawArgv: ['--dims=2048', '--no-scheduler', '--no-scm-annotate']
});
assert.ok(stage2RawFallback.includes('--dims'), 'expected raw fallback to preserve --dims');
assert.ok(stage2RawFallback.includes('2048'), 'expected raw fallback to preserve --dims value');
assert.ok(stage2RawFallback.includes('--no-scheduler'), 'expected raw fallback to preserve --no-scheduler');
assert.ok(stage2RawFallback.includes('--no-scm-annotate'), 'expected raw fallback to preserve --no-scm-annotate');

console.log('stage2 args cache-rebuild propagation test passed');
