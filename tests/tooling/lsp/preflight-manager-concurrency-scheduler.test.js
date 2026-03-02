#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  awaitToolingProviderPreflight,
  getToolingProviderPreflightSchedulerMetrics,
  kickoffToolingProviderPreflights
} from '../../../src/index/tooling/preflight-manager.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logs = [];
const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {
    preflight: {
      maxConcurrency: 1
    }
  },
  logger: (line) => logs.push(String(line || ''))
};

let runningCount = 0;
let runningPeak = 0;
const createProvider = (id) => ({
  id,
  preflightId: `${id}.workspace-model`,
  preflightClass: 'workspace',
  getConfigHash() {
    return `${id}-hash`;
  },
  async preflight() {
    runningCount += 1;
    runningPeak = Math.max(runningPeak, runningCount);
    await wait(40);
    runningCount = Math.max(0, runningCount - 1);
    return { state: 'ready' };
  }
});

const providerA = createProvider('preflight-a');
const providerB = createProvider('preflight-b');
const plans = [
  {
    provider: providerA,
    documents: [{ virtualPath: 'src/a.fixture', languageId: 'fixture' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-a', chunkId: 'chunk-a', file: 'src/a.fixture' } }]
  },
  {
    provider: providerB,
    documents: [{ virtualPath: 'src/b.fixture', languageId: 'fixture' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-b', chunkId: 'chunk-b', file: 'src/b.fixture' } }]
  }
];

const waveToken = kickoffToolingProviderPreflights(ctx, plans);
assert.equal(typeof waveToken, 'string', 'expected kickoff wave token');

await Promise.all([
  awaitToolingProviderPreflight(ctx, {
    provider: providerA,
    inputs: plans[0],
    waveToken
  }),
  awaitToolingProviderPreflight(ctx, {
    provider: providerB,
    inputs: plans[1],
    waveToken
  })
]);

assert.equal(runningPeak, 1, 'expected max preflight concurrency cap to be enforced');
const metrics = getToolingProviderPreflightSchedulerMetrics(ctx);
assert.equal(metrics.maxConcurrency, 1, 'expected scheduler maxConcurrency to reflect config');
assert.ok(metrics.queuedTotal >= 1, 'expected at least one queued preflight');
assert.ok(metrics.queueDepthPeak >= 1, 'expected queue depth peak');
assert.ok(metrics.queueWaitSamples >= 1, 'expected queue wait samples');
assert.ok(
  logs.some((line) => line.includes('preflight:queued provider=')),
  'expected queued preflight log'
);
assert.ok(
  logs.some((line) => line.includes('preflight:dequeued provider=')),
  'expected dequeued preflight log'
);

console.log('preflight manager scheduler concurrency test passed');
