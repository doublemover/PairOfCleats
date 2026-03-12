#!/usr/bin/env node
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';

applyTestEnv();

const { fixtureRoot, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-mcp-risk-explain',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
if (!Array.isArray(flows) || flows.length === 0) {
  console.log('risk flows unavailable; skipping MCP risk explain test.');
  process.exit(0);
}

const flow = flows[0];
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

await withTemporaryEnv(env, async () => {
  const result = await handleToolCall('risk_explain', {
    repoPath: fixtureRoot,
    chunk: chunkUid,
    max: 5,
    filters: {
      flowId: flow.flowId,
      sourceRule: flow.source?.ruleId,
      sinkRule: flow.sink?.ruleId
    }
  });
  assert.deepEqual(result.flows?.map((entry) => entry.flowId), [flow.flowId]);
  assert.deepEqual(result.filters, {
    rule: [],
    category: [],
    severity: [],
    tag: [],
    source: [],
    sink: [],
    sourceRule: [flow.source?.ruleId],
    sinkRule: [flow.sink?.ruleId],
    flowId: [flow.flowId]
  });
});

console.log('MCP risk explain test passed');
