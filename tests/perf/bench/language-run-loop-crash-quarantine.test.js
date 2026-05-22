#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createBenchRunLoopFixture, createMemoryBenchSummary } from './run-loop-fixture.js';

const fixture = await createBenchRunLoopFixture({
  name: 'bench-crash-quarantine',
  repo: 'dreamworksanimation/openmoonray',
  language: 'cmake',
  repoDirName: 'openmoonray',
  repoLabel: 'cmake/dreamworksanimation/openmoonray',
  fallbackLogSlug: 'openmoonray'
});

const runCalls = [];
let attachCalls = 0;
const results = await fixture.run({
  processRunner: {
    runProcess: async (label, _cmd, _args, options = {}) => {
      runCalls.push({
        label,
        workerPool: options?.env?.PAIROFCLEATS_WORKER_POOL || null
      });
      if (runCalls.length === 1) {
        return {
          ok: false,
          code: 3221225477,
          signal: null,
          schedulerEvents: [],
          diagnostics: {
            crashAttribution: {
              crashClass: 'windows_access_violation',
              recentCleanupLabel: 'runtime.worker-pools.destroy',
              activePhase: 'execute'
            }
          },
          progressConfidence: { bucket: 'low', score: 0.25 }
        };
      }
      await fs.writeFile(fixture.outFile, JSON.stringify(createMemoryBenchSummary()), 'utf8');
      return {
        ok: true,
        schedulerEvents: [],
        diagnostics: { countsByType: {} },
        progressConfidence: { bucket: 'high', score: 1 }
      };
    }
  },
  lifecycle: {
    hasRepoPath: () => true,
    ensureRepoPresent: async () => ({ ok: true }),
    prepareRepoWorkspace: async () => ({ ok: true }),
    attachCrashRetention: async () => {
      attachCalls += 1;
      return {
        bundlePath: path.join(fixture.tempRoot, 'crash-bundle.json'),
        crashState: {
          phase: 'stage3:init'
        }
      };
    },
    cleanRepoCache: async () => {}
  }
});

assert.equal(runCalls.length, 2, 'expected one crash attempt and one quarantine retry');
assert.equal(runCalls[0].workerPool, null, 'expected initial attempt to use default worker-pool config');
assert.equal(runCalls[1].workerPool, 'off', 'expected quarantine retry to disable worker pools');
assert.equal(attachCalls, 1, 'expected one retained crash bundle before quarantine retry');
assert.equal(results.length, 1, 'expected one repo result');
assert.equal(results[0]?.failed, undefined, 'expected quarantine retry to recover the repo result');
assert.equal(
  results[0]?.diagnostics?.crashQuarantineRecovery?.quarantineId,
  'openmoonray-worker-pool-off',
  'expected quarantine recovery metadata on successful retry'
);

await fixture.cleanup();

console.log('bench run loop crash quarantine test passed');
