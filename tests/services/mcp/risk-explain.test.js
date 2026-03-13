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
const partialFlows = await loadJsonArrayArtifact(codeDir, 'risk_partial_flows', { strict: false }).catch(() => []);
if ((!Array.isArray(flows) || flows.length === 0) && (!Array.isArray(partialFlows) || partialFlows.length === 0)) {
  console.log('risk flows unavailable; skipping MCP risk explain test.');
  process.exit(0);
}

const flow = Array.isArray(flows) && flows.length ? flows[0] : null;
const partialFlow = Array.isArray(partialFlows) && partialFlows.length ? partialFlows[0] : null;
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid || partialFlow?.source?.chunkUid || partialFlow?.frontier?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

await withTemporaryEnv(env, async () => {
  const result = await handleToolCall('risk_explain', {
    repoPath: fixtureRoot,
    chunk: chunkUid,
    max: 5,
    includePartialFlows: true,
    maxPartialFlows: 2,
    filters: {
      flowId: flow?.flowId,
      sourceRule: flow?.source?.ruleId,
      sinkRule: flow?.sink?.ruleId
    }
  });
  assert.deepEqual(result.flows?.map((entry) => entry.flowId), flow ? [flow.flowId] : []);
  assert.ok(result.flows?.[0]?.path?.watchByStep?.[0], 'expected MCP risk explain to preserve watch window state');
  assert.deepEqual(result.partialFlows, [], 'expected no partial flows in simple fixture');
  assert.deepEqual(result.filters, {
    rule: [],
    category: [],
    severity: [],
    tag: [],
    source: [],
    sink: [],
    sourceRule: flow?.source?.ruleId ? [flow.source.ruleId] : [],
    sinkRule: flow?.sink?.ruleId ? [flow.sink.ruleId] : [],
    flowId: flow?.flowId ? [flow.flowId] : []
  });
});

console.log('MCP risk explain test passed');
