#!/usr/bin/env node
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApiRouter } from '../../../tools/api/router.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';

applyTestEnv();

const { fixtureRoot, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-api-risk-explain',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
const partialFlows = await loadJsonArrayArtifact(codeDir, 'risk_partial_flows', { strict: false }).catch(() => []);
if ((!Array.isArray(flows) || flows.length === 0) && (!Array.isArray(partialFlows) || partialFlows.length === 0)) {
  console.log('risk flows unavailable; skipping API risk explain test.');
  process.exit(0);
}

const flow = Array.isArray(flows) && flows.length ? flows[0] : null;
const partialFlow = Array.isArray(partialFlows) && partialFlows.length ? partialFlows[0] : null;
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid || partialFlow?.source?.chunkUid || partialFlow?.frontier?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

await withTemporaryEnv(env, async () => {
  const router = createApiRouter({
    host: '127.0.0.1',
    defaultRepo: fixtureRoot,
    defaultOutput: 'json',
    metricsRegistry: null
  });
  const server = http.createServer((req, res) => router.handleRequest(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/analysis/risk-explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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
      })
    });
    assert.equal(response.status, 200, 'expected filtered risk explain request to succeed');
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.result?.flows?.map((entry) => entry.flowId), flow ? [flow.flowId] : []);
    assert.ok(payload.result?.flows?.[0]?.path?.watchByStep?.[0], 'expected API risk explain to preserve watch window state');
    assert.deepEqual(payload.result?.partialFlows, [], 'expected no partial flows in simple fixture');
    assert.deepEqual(payload.result?.filters, {
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

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/analysis/risk-explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoPath: fixtureRoot,
        chunk: chunkUid,
        includePartialFlows: true,
        filters: { severity: 'urgent' }
      })
    });
    assert.equal(invalidResponse.status, 400, 'expected invalid risk filters to fail');
    const invalidPayload = await invalidResponse.json();
    assert.equal(invalidPayload.ok, false);
  } finally {
    server.close();
    if (typeof router.close === 'function') router.close();
  }
});

console.log('API risk explain filters test passed');
