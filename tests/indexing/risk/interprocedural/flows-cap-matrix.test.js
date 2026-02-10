#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { runFlowCapScenario } from './helpers/flow-cap-matrix.js';

applyTestEnv();

const cases = [
  {
    id: 'conservative',
    run: () => runFlowCapScenario(),
    verify: (result) => {
      assert.equal(result.status, 'ok');
      assert.equal(result.flowRows.length, 1, 'expected a single flow');
      const flow = result.flowRows[0];
      assert.equal(flow.source.chunkUid, 'uid-source');
      assert.equal(flow.sink.chunkUid, 'uid-sink');
      assert.equal(flow.path.chunkUids.length, 2);
      assert.equal(flow.path.callSiteIdsByStep.length, 1);
      assert.ok(Array.isArray(flow.path.callSiteIdsByStep[0]));
      assert.ok(flow.flowId.startsWith('sha1:'), 'flowId should be sha1');
      const expectedConfidence = Math.max(0.05, Math.min(1, Math.sqrt(0.6 * 0.8) * 0.85));
      assert.ok(
        Math.abs(flow.confidence - expectedConfidence) < 1e-6,
        `expected confidence ${expectedConfidence}, got ${flow.confidence}`
      );
    }
  },
  {
    id: 'max-total-flows-zero',
    run: () => runFlowCapScenario({ caps: { maxTotalFlows: 0 } }),
    verify: (result) => {
      assert.equal(result.status, 'ok');
      assert.equal(result.flowRows.length, 0, 'maxTotalFlows=0 should emit zero flows');
      assert.ok(
        Array.isArray(result.stats?.capsHit) && result.stats.capsHit.includes('maxTotalFlows'),
        'stats.capsHit should include maxTotalFlows'
      );
    }
  },
  {
    id: 'timeout-overflow',
    run: () => runFlowCapScenario({ caps: { maxMs: 10 }, nowStepMs: 20 }),
    verify: (result) => {
      assert.equal(result.status, 'timed_out');
      assert.equal(result.flowRows.length, 0, 'timeout should emit no flows');
    }
  }
];

for (const testCase of cases) {
  const result = testCase.run();
  testCase.verify(result);
}

console.log('risk interprocedural flow cap matrix test passed');
