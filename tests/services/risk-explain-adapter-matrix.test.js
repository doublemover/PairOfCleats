#!/usr/bin/env node
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { loadJsonArrayArtifact } from '../../src/shared/artifact-io.js';
import { createApiRouter } from '../../tools/api/router.js';
import { handleToolCall } from '../../tools/mcp/tools.js';
import { getCombinedOutput } from '../helpers/stdio.js';

applyTestEnv();

const { root, fixtureRoot, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-adapter-risk-explain',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
const partialFlows = await loadJsonArrayArtifact(codeDir, 'risk_partial_flows', { strict: false }).catch(() => []);
if ((!Array.isArray(flows) || flows.length === 0) && (!Array.isArray(partialFlows) || partialFlows.length === 0)) {
  console.log('risk flows unavailable; skipping risk explain adapter matrix.');
  process.exit(0);
}

const flow = Array.isArray(flows) && flows.length ? flows[0] : null;
const partialFlow = Array.isArray(partialFlows) && partialFlows.length ? partialFlows[0] : null;
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid || partialFlow?.source?.chunkUid || partialFlow?.frontier?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

const expectedFilters = {
  rule: [],
  category: [],
  severity: [],
  tag: [],
  source: [],
  sink: [],
  sourceRule: flow?.source?.ruleId ? [flow.source.ruleId] : [],
  sinkRule: flow?.sink?.ruleId ? [flow.sink.ruleId] : [],
  flowId: flow?.flowId ? [flow.flowId] : []
};

await withTemporaryEnv(env, async () => {
  {
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
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.ok, true);
      assert.deepEqual(payload.result?.flows?.map((entry) => entry.flowId), flow ? [flow.flowId] : []);
      assert.ok(payload.result?.flows?.[0]?.path?.watchByStep?.[0]);
      assert.deepEqual(payload.result?.partialFlows, []);
      assert.deepEqual(payload.result?.filters, expectedFilters);

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
      assert.equal(invalidResponse.status, 400);
      const invalidPayload = await invalidResponse.json();
      assert.equal(invalidPayload.ok, false);
    } finally {
      server.close();
      if (typeof router.close === 'function') router.close();
    }
  }

  {
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
    assert.ok(result.flows?.[0]?.path?.watchByStep?.[0]);
    assert.deepEqual(result.partialFlows, []);
    assert.deepEqual(result.filters, expectedFilters);

    let invalidChunkError = null;
    try {
      await handleToolCall('risk_explain', {
        repoPath: fixtureRoot,
        chunk: 'chunk:missing-risk-explain-test'
      });
    } catch (err) {
      invalidChunkError = err;
    }

    assert.ok(invalidChunkError);
    assert.equal(invalidChunkError.code, 'INVALID_REQUEST');
    assert.equal(invalidChunkError.reason, 'unknown_chunk_uid');
  }

  {
    const binPath = path.join(root, 'bin', 'pairofcleats.js');
    const result = spawnSync(
      process.execPath,
      [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '1'],
      { encoding: 'utf8', env }
    );
    assert.equal(result.status, 0);
    const output = getCombinedOutput(result, { trim: true });
    assert.ok(output.includes(flow.flowId));
    assert.ok(output.includes('src/index.js'));

    const filteredResult = spawnSync(
      process.execPath,
      [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '5', '--flow-id', flow.flowId],
      { encoding: 'utf8', env }
    );
    assert.equal(filteredResult.status, 0);
    assert.ok(getCombinedOutput(filteredResult, { trim: true }).includes(flow.flowId));

    const jsonResult = spawnSync(
      process.execPath,
      [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '1', '--json', '--includePartialFlows', '--maxPartialFlows', '2'],
      { encoding: 'utf8', env }
    );
    assert.equal(jsonResult.status, 0);
    const jsonPayload = JSON.parse(getCombinedOutput(jsonResult, { trim: true }));
    assert.equal(jsonPayload.rendered.flowSelection.totalFlows, 1);
    assert.equal(jsonPayload.rendered.partialFlowSelection.totalPartialFlows, partialFlow ? 1 : 0);
    if (flow) {
      assert.ok(jsonPayload.rendered.flows?.[0]?.steps?.[0]?.watchWindow);
      assert.ok(jsonPayload.flows?.[0]?.path?.watchByStep?.[0]);
    }
  }
});

console.log('risk explain adapter matrix test passed');
