#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  awaitToolingProviderPreflight,
  kickoffToolingProviderPreflights,
  listToolingProviderPreflightStates,
  readToolingProviderPreflightState
} from '../../../src/index/tooling/preflight-manager.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const logs = [];
const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  logger: (line) => logs.push(String(line || '')),
  toolingConfig: {}
};

let runCount = 0;
const provider = {
  id: 'sourcekit',
  preflightId: 'sourcekit.package-resolution',
  getConfigHash() {
    return 'hash-a';
  },
  async preflight() {
    runCount += 1;
    await wait(40);
    return { state: 'ready', blockSourcekit: false, check: null };
  }
};

const waveToken = kickoffToolingProviderPreflights(ctx, [{
  provider,
  documents: [{ virtualPath: 'a.swift', languageId: 'swift' }],
  targets: [{ chunkRef: { chunkUid: 'chunk-1', file: 'a.swift', chunkId: 1 } }]
}]);
assert.equal(typeof waveToken, 'string', 'expected kickoff to return wave token');

await wait(5);
const runningSnapshot = readToolingProviderPreflightState(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'a.swift', languageId: 'swift' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-1', file: 'a.swift', chunkId: 1 } }]
  }
});
assert.equal(runningSnapshot?.state, 'running', 'expected running snapshot while preflight is in-flight');
const first = await awaitToolingProviderPreflight(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'a.swift', languageId: 'swift' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-1', file: 'a.swift', chunkId: 1 } }]
  },
  waveToken
});
assert.equal(runCount, 1, 'expected kickoff and await to share one in-flight preflight execution');
assert.equal(first?.state, 'ready', 'expected preflight ready result');

const second = await awaitToolingProviderPreflight(ctx, {
  provider,
  inputs: {
    documents: [{ virtualPath: 'a.swift', languageId: 'swift' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-1', file: 'a.swift', chunkId: 1 } }]
  },
  waveToken
});
assert.equal(runCount, 1, 'expected settled preflight result to be reused without rerun');
assert.equal(second?.state, 'ready', 'expected cached preflight result');
assert.ok(
  logs.some((line) => line.includes('preflight:start provider=sourcekit')),
  'expected preflight start log'
);
assert.ok(
  logs.some((line) => line.includes('preflight:ok provider=sourcekit')),
  'expected preflight ok log'
);
assert.ok(
  logs.some((line) => line.includes('preflight:cache_hit provider=sourcekit')),
  'expected cache hit log'
);

const snapshotsAfterSuccess = listToolingProviderPreflightStates(ctx);
assert.equal(snapshotsAfterSuccess.length >= 1, true, 'expected preflight snapshots after completion');
const successSnapshot = snapshotsAfterSuccess.find((entry) => entry.providerId === 'sourcekit');
assert.equal(successSnapshot?.state, 'ready', 'expected ready snapshot after completion');
assert.equal(successSnapshot?.diagnostic?.state, 'ready', 'expected ready diagnostic state');

let rejectCount = 0;
const failingProvider = {
  id: 'sourcekit',
  preflightId: 'sourcekit.package-resolution',
  getConfigHash() {
    return 'hash-b';
  },
  async preflight() {
    rejectCount += 1;
    throw new Error('forced preflight failure');
  }
};

let firstError = null;
const failingWaveToken = 'failing-wave';
try {
  await awaitToolingProviderPreflight(ctx, {
    provider: failingProvider,
    inputs: {
      documents: [{ virtualPath: 'b.swift', languageId: 'swift' }],
      targets: [{ chunkRef: { chunkUid: 'chunk-2', file: 'b.swift', chunkId: 2 } }]
    },
    waveToken: failingWaveToken
  });
} catch (error) {
  firstError = error;
}
assert.ok(firstError, 'expected first failing preflight call to reject');
assert.equal(rejectCount, 1, 'expected one failing preflight execution');

let secondError = null;
try {
  await awaitToolingProviderPreflight(ctx, {
    provider: failingProvider,
    inputs: {
      documents: [{ virtualPath: 'b.swift', languageId: 'swift' }],
      targets: [{ chunkRef: { chunkUid: 'chunk-2', file: 'b.swift', chunkId: 2 } }]
    },
    waveToken: failingWaveToken
  });
} catch (error) {
  secondError = error;
}
assert.ok(secondError, 'expected cached failing preflight to reject');
assert.equal(rejectCount, 1, 'expected failing preflight rejection to be cached');
const failingSnapshot = readToolingProviderPreflightState(ctx, {
  provider: failingProvider,
  inputs: {
    documents: [{ virtualPath: 'b.swift', languageId: 'swift' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-2', file: 'b.swift', chunkId: 2 } }]
  }
});
assert.equal(failingSnapshot?.state, 'failed', 'expected failed snapshot after cached rejection');
assert.equal(
  failingSnapshot?.diagnostic?.reasonCode,
  'preflight_failed',
  'expected failed diagnostic reason code'
);

let noopRunCount = 0;
const noopProvider = {
  id: 'no-op-provider',
  preflightId: 'no-op-provider.health-check',
  getConfigHash() {
    return 'noop-hash';
  },
  async preflight() {
    noopRunCount += 1;
    return { state: 'degraded', reasonCode: 'preflight_command_unavailable' };
  }
};
const noopResult = await awaitToolingProviderPreflight(ctx, {
  provider: noopProvider,
  inputs: {
    documents: [{ virtualPath: 'noop.txt', languageId: 'plaintext' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-3', file: 'noop.txt', chunkId: 3 } }]
  },
  waveToken: 'noop-wave'
});
assert.equal(noopRunCount, 1, 'expected no-op preflight to run once');
assert.equal(noopResult?.state, 'degraded', 'expected no-op preflight result state');
const noopSnapshot = readToolingProviderPreflightState(ctx, {
  provider: noopProvider,
  inputs: {
    documents: [{ virtualPath: 'noop.txt', languageId: 'plaintext' }],
    targets: [{ chunkRef: { chunkUid: 'chunk-3', file: 'noop.txt', chunkId: 3 } }]
  }
});
assert.equal(noopSnapshot?.state, 'degraded', 'expected no-op provider degraded snapshot');
assert.equal(
  noopSnapshot?.diagnostic?.reasonCode,
  'preflight_command_unavailable',
  'expected no-op reason code to persist'
);

console.log('preflight manager single-flight test passed');
