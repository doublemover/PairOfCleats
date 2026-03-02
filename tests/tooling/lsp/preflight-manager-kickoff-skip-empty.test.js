#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  kickoffToolingProviderPreflights,
  listToolingProviderPreflightStates
} from '../../../src/index/tooling/preflight-manager.js';

const ctx = {
  repoRoot: process.cwd(),
  buildRoot: process.cwd(),
  toolingConfig: {},
  logger: () => {}
};

let runCount = 0;
const provider = {
  id: 'kickoff-empty-fixture',
  preflightId: 'kickoff-empty-fixture.preflight',
  getConfigHash() {
    return 'kickoff-empty-hash';
  },
  async preflight() {
    runCount += 1;
    return { state: 'ready' };
  }
};

const waveToken = kickoffToolingProviderPreflights(ctx, [
  { provider, documents: [], targets: [] },
  {
    provider,
    documents: [{ virtualPath: 'src/file.fixture', languageId: 'fixture' }],
    targets: []
  }
]);

assert.equal(typeof waveToken, 'string', 'expected kickoff to still return a wave token');
assert.equal(runCount, 0, 'expected kickoff to skip empty plans');
const snapshots = listToolingProviderPreflightStates(ctx);
assert.equal(snapshots.length, 0, 'expected no preflight snapshots when kickoff plans are empty');

console.log('preflight manager kickoff skip empty plans test passed');
