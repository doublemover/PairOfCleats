#!/usr/bin/env node
import assert from 'node:assert/strict';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  createProcessRunner,
  resolveIdleBudgetExtension
} from '../../../tools/bench/language/process.js';

ensureTestingEnv(process.env);

const runner = createProcessRunner({
  appendLog: () => {},
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory: [],
  logPath: null,
  getLogPaths: () => [],
  onProgressEvent: () => {},
  sampleProcessActivity: async () => null
});

const clampedExtension = resolveIdleBudgetExtension({
  decision: {
    effectiveBudgetMs: 280
  },
  currentIdleBudgetMs: 140,
  hardTimeoutCapMs: 160,
  processElapsedMs: 150
});
assert.equal(clampedExtension.extended, false, 'expected hard-cap headroom clamp to suppress fake idle-budget extensions');
assert.equal(clampedExtension.nextIdleBudgetMs, 10, 'expected clamped idle budget to honor remaining hard-cap headroom');

const qualityDeltaScript = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const emit = (event, payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event, ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  emit('task:progress', {",
  "    taskId: 'tooling:providers',",
  "    stage: 'relations',",
  "    current: 120,",
  "    total: 300,",
  "    message: 'provider runtime active',",
  "    meta: {",
  "      timeoutPolicy: {",
  "        ownerId: 'tooling-orchestrator',",
  "        ladderId: 'provider-bootstrap',",
  "        phase: 'provider_bootstrap',",
  "        queueExpected: false,",
  "        byteProgressExpected: false,",
  "        optionalPhase: true,",
  "        skippedWork: ['provider-enrichment', 'provider-ladder', 'provider-requests', 'workspace-preflight'],",
  "        partialSuccess: true",
  '      }',
  '    }',
  '  });',
  '  await wait(10_000);',
  '})();'
].join('');

const qualityDeltaResult = await runner.runProcess(
  'bench-timeout-ownership-quality-delta',
  process.execPath,
  ['-e', qualityDeltaScript],
  {
    continueOnError: true,
    timeoutMs: 140
  }
);

assert.equal(qualityDeltaResult.ok, false, 'expected provider timeout result');
assert.equal(qualityDeltaResult.timeoutKind, 'hard', 'expected provider hard timeout kind');
assert.equal(
  qualityDeltaResult.timeoutDecision?.phase,
  'provider_bootstrap',
  'expected stage-owned policy to control timeout phase attribution'
);
assert.deepEqual(
  qualityDeltaResult.timeoutDecision?.qualityDelta?.skippedWork,
  ['provider-enrichment', 'provider-ladder', 'provider-requests', 'workspace-preflight'],
  'expected timeout quality delta to come from the stage-owned degradation ladder'
);
assert.equal(
  qualityDeltaResult.timeoutDecision?.qualityDelta?.partialSuccess,
  true,
  'expected stage-owned degradation ladder to declare partial success'
);

console.log('bench language process timeout ownership test passed');
