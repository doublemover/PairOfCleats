#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  buildShardFeatureWeights,
  buildShardSummary,
  createInitialShardExecutionMeta,
  resolveShardPlanningPreflight
} from '../../../src/index/build/indexer/steps/process-files/shard-preflight.js';

ensureTestingEnv(process.env);

const weighted = buildShardFeatureWeights({
  relationsEnabled: true,
  runtime: {
    astDataflowEnabled: false,
    controlFlowEnabled: true,
    languageOptions: { treeSitter: { enabled: true } },
    toolingEnabled: true,
    embeddingEnabled: false
  }
});
assert.deepEqual(
  weighted,
  {
    relations: 0.15,
    flow: 0.1,
    treeSitter: 0.1,
    tooling: 0.1,
    embeddings: 0
  },
  'expected shard feature weights to project enabled runtime features'
);

const shardSummary = buildShardSummary([
  {
    id: 's-1',
    label: 'Shard One',
    dir: 'src',
    lang: 'js',
    entries: [{ rel: 'a.js' }, { rel: 'b.js' }],
    lineCount: 120,
    byteCount: 2048,
    costMs: 300
  }
]);
assert.deepEqual(
  shardSummary,
  [{
    id: 's-1',
    label: 'Shard One',
    dir: 'src',
    lang: 'js',
    fileCount: 2,
    lineCount: 120,
    byteCount: 2048,
    costMs: 300
  }],
  'expected shard summary rows to preserve plan metadata and derived file count'
);

assert.deepEqual(
  createInitialShardExecutionMeta({ shardsEnabled: false }),
  { enabled: false },
  'expected disabled shard execution metadata when shard feature is off'
);

const runtime = {
  cpuConcurrency: 6,
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  languageOptions: { treeSitter: { enabled: true } },
  toolingEnabled: false,
  embeddingEnabled: true,
  shards: {
    enabled: true,
    maxShards: 8,
    minFiles: 2,
    dirDepth: 3,
    maxShardBytes: 64000,
    maxShardLines: 5000,
    cluster: {
      enabled: true,
      deterministicMerge: true
    }
  }
};

const entries = [{ rel: 'src/a.js', lines: 0 }, { rel: 'src/b.js', lines: 0 }];
const lineCounts = new Map([
  ['src/a.js', 10],
  ['src/b.js', 20]
]);
let countedLines = 0;
let planned = 0;
let plannedOptions = null;
const logs = [];
const timing = {};
const preflight = await resolveShardPlanningPreflight({
  entries,
  runtime,
  mode: 'code',
  relationsEnabled: false,
  shardPerfProfile: { bias: 1 },
  discoveryLineCounts: null,
  hasPositiveLineCounts: false,
  timing,
  verbose: true,
  log: (line) => logs.push(line),
  countLinesForEntriesFn: async (inputEntries, options) => {
    countedLines += 1;
    assert.equal(inputEntries, entries, 'expected line counting to receive stage entries');
    assert.equal(options.concurrency, 12, 'expected preflight line counting concurrency derived from cpuConcurrency');
    return lineCounts;
  },
  planShardsFn: (inputEntries, options) => {
    planned += 1;
    plannedOptions = options;
    assert.equal(inputEntries, entries, 'expected shard planning to receive stage entries');
    return [{
      id: 's-1',
      label: 's-1',
      dir: 'src',
      lang: 'js',
      entries: [{ rel: 'src/a.js' }, { rel: 'src/b.js' }],
      lineCount: 30,
      byteCount: 3000,
      costMs: 180
    }];
  }
});

assert.equal(countedLines, 1, 'expected fallback line counting when no discovery or entry line counts are available');
assert.equal(planned, 1, 'expected shard planning to run when shards are enabled');
assert.equal(plannedOptions.lineCounts, lineCounts, 'expected computed line counts to be forwarded to shard planning');
assert.ok(Number.isFinite(timing.lineCountsMs), 'expected line-count timing telemetry to be populated');
assert.equal(preflight.clusterModeEnabled, true, 'expected cluster mode projection from runtime flags');
assert.equal(preflight.clusterDeterministicMerge, true, 'expected deterministic merge projection from runtime flags');
assert.equal(preflight.shardExecutionMeta.mode, 'cluster', 'expected initial shard execution metadata mode');
assert.equal(preflight.shardExecutionMeta.mergeOrder, 'stable', 'expected initial shard merge mode metadata');
assert.equal(preflight.shardSummary.length, 1, 'expected shard summary projection for planned shard set');
assert.equal(logs.length, 1, 'expected verbose line counting diagnostic log');

let skippedLineCountingCalls = 0;
await resolveShardPlanningPreflight({
  entries,
  runtime,
  mode: 'code',
  hasPositiveLineCounts: true,
  countLinesForEntriesFn: async () => {
    skippedLineCountingCalls += 1;
    return new Map();
  },
  planShardsFn: () => []
});
assert.equal(
  skippedLineCountingCalls,
  0,
  'expected preflight to skip fallback line counting when entry pass already found line counts'
);

console.log('process-files shard preflight helper test passed');
