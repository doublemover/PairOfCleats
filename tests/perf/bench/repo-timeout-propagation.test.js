#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { createBenchRunLoopFixture, createMemoryBenchSummary } from './run-loop-fixture.js';
import {
  resolveBenchProcessTimeoutProfile,
  resolveBenchRuntimeAdaptationPlan
} from '../../../tools/bench/language/timeout.js';

const fixture = await createBenchRunLoopFixture({
  name: 'bench-timeout-propagation',
  repoDirName: 'demo',
  fallbackLogSlug: 'demo-repo'
});

let capturedTimeoutMs = null;
let capturedIdleTimeoutMs = null;
const results = await fixture.run({
  processRunner: {
    runProcess: async (_label, _cmd, _args, options = {}) => {
      capturedTimeoutMs = options.timeoutMs;
      capturedIdleTimeoutMs = options.idleTimeoutMs;
      await fs.writeFile(fixture.outFile, JSON.stringify(createMemoryBenchSummary()), 'utf8');
      return { ok: true, schedulerEvents: [] };
    }
  }
});

const adaptationPlan = resolveBenchRuntimeAdaptationPlan({
  repoTimeoutMs: 4321,
  language: null,
  lineStats: null,
  buildIndex: true,
  buildSqlite: false,
  backendCount: 1,
  realEmbeddings: false,
  requestedThreads: null
});
const expectedTimeoutProfile = resolveBenchProcessTimeoutProfile({
  repoTimeoutMs: adaptationPlan.repoTimeoutMs
});
assert.equal(capturedIdleTimeoutMs, expectedTimeoutProfile.idleTimeoutMs, 'expected idle bench timeout to be forwarded to the repo subprocess');
assert.equal(capturedTimeoutMs, expectedTimeoutProfile.hardTimeoutMs, 'expected hard bench timeout profile to be forwarded to the repo subprocess');
assert.equal(Array.isArray(results), true, 'expected result list');
assert.equal(results.length, 1, 'expected one result row');
assert.equal(results[0]?.failed, undefined, 'expected successful repo result');

await fixture.cleanup();

console.log('bench repo timeout propagation test passed');
