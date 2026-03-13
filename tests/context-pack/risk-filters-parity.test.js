#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { loadJsonArrayArtifact } from '../../src/shared/artifact-io.js';
import { createApiRouter } from '../../tools/api/router.js';
import { handleToolCall } from '../../tools/mcp/tools.js';

applyTestEnv();

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');

const runCliJson = (args) => {
  const result = spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    env: process.env
  });
  const stdout = result.stdout?.trim() || '';
  const stderr = result.stderr?.trim() || '';
  const parsed = stdout ? JSON.parse(stdout) : null;
  return {
    status: result.status,
    stdout,
    stderr,
    parsed
  };
};

const normalizeRisk = (payload) => ({
  status: payload?.risk?.status || null,
  filters: payload?.risk?.filters || null,
  flowIds: Array.isArray(payload?.risk?.flows) ? payload.risk.flows.map((flow) => flow.flowId) : [],
  partialFlowIds: Array.isArray(payload?.risk?.partialFlows) ? payload.risk.partialFlows.map((flow) => flow.partialFlowId) : []
});

const { fixtureRoot, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-context-pack-parity',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
const partialFlows = await loadJsonArrayArtifact(codeDir, 'risk_partial_flows', { strict: false }).catch(() => []);
if ((!Array.isArray(flows) || flows.length === 0) && (!Array.isArray(partialFlows) || partialFlows.length === 0)) {
  console.log('risk flows unavailable; skipping context-pack parity test.');
  process.exit(0);
}

const flow = Array.isArray(flows) && flows.length ? flows[0] : null;
const partialFlow = Array.isArray(partialFlows) && partialFlows.length ? partialFlows[0] : null;
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid || partialFlow?.source?.chunkUid || partialFlow?.frontier?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

await withTemporaryEnv(env, async () => {
  const args = {
    repoPath: fixtureRoot,
    seed: `chunk:${chunkUid}`,
    hops: 0,
    includeRisk: true,
    includeRiskPartialFlows: true,
    filters: {
      flowId: flow?.flowId,
      sourceRule: flow?.source?.ruleId,
      sinkRule: flow?.sink?.ruleId
    }
  };

  const cliRun = runCliJson([
    'context-pack',
    '--json',
    '--repo', fixtureRoot,
    '--seed', args.seed,
    '--hops', String(args.hops),
    '--includeRisk',
    '--includeRiskPartialFlows',
    '--flow-id', flow?.flowId || '',
    '--source-rule', flow?.source?.ruleId || '',
    '--sink-rule', flow?.sink?.ruleId || ''
  ]);
  assert.equal(cliRun.status, 0, `expected CLI context-pack call to succeed: ${cliRun.stderr}`);
  const cliPayload = cliRun.parsed;

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
    const apiResponse = await fetch(`http://127.0.0.1:${port}/analysis/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args)
    });
    assert.equal(apiResponse.status, 200, 'expected filtered context-pack API request to succeed');
    const apiPayload = await apiResponse.json();
    assert.equal(apiPayload.ok, true);

    const mcpPayload = await handleToolCall('context_pack', args);

    const expected = normalizeRisk(cliPayload);
    assert.deepEqual(normalizeRisk(apiPayload.result), expected, 'expected API context-pack risk output to match CLI');
    assert.deepEqual(normalizeRisk(mcpPayload), expected, 'expected MCP context-pack risk output to match CLI');

    const emptyArgs = {
      ...args,
      filters: { flowId: 'sha1:ffffffffffffffffffffffffffffffffffffffff' }
    };
    const emptyCli = runCliJson([
      'context-pack',
      '--json',
      '--repo', fixtureRoot,
      '--seed', emptyArgs.seed,
      '--hops', String(emptyArgs.hops),
      '--includeRisk',
      '--flow-id', 'sha1:ffffffffffffffffffffffffffffffffffffffff'
    ]).parsed;
    assert.deepEqual(normalizeRisk(emptyCli).flowIds, [], 'expected CLI empty filter result to stay non-fatal');

    const emptyApiResponse = await fetch(`http://127.0.0.1:${port}/analysis/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(emptyArgs)
    });
    assert.equal(emptyApiResponse.status, 200, 'expected empty filtered context-pack API request to stay non-fatal');
    const emptyApiPayload = await emptyApiResponse.json();
    assert.deepEqual(normalizeRisk(emptyApiPayload.result).flowIds, [], 'expected API empty filter result to stay non-fatal');

    const emptyMcpPayload = await handleToolCall('context_pack', emptyArgs);
    assert.deepEqual(normalizeRisk(emptyMcpPayload).flowIds, [], 'expected MCP empty filter result to stay non-fatal');

    const snakeCaseApiResponse = await fetch(`http://127.0.0.1:${port}/analysis/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        filters: {
          flow_id: flow?.flowId,
          source_rule: flow?.source?.ruleId,
          sink_rule: flow?.sink?.ruleId
        }
      })
    });
    assert.equal(snakeCaseApiResponse.status, 200, 'expected snake_case API context-pack filters to succeed');
    const snakeCaseApiPayload = await snakeCaseApiResponse.json();
    assert.deepEqual(
      normalizeRisk(snakeCaseApiPayload.result),
      expected,
      'expected snake_case API filters to match canonical filtered risk output'
    );

    const invalidCli = runCliJson([
      'context-pack',
      '--json',
      '--repo', fixtureRoot,
      '--seed', args.seed,
      '--hops', String(args.hops),
      '--includeRisk',
      '--severity', 'urgent'
    ]);
    assert.equal(invalidCli.status, 1, 'expected CLI invalid filter to fail');
    assert.equal(invalidCli.parsed?.ok, false, 'expected CLI invalid filter to fail');
    assert.equal(invalidCli.parsed?.code, 'ERR_CONTEXT_PACK_RISK_FILTER_INVALID');

    const invalidApiResponse = await fetch(`http://127.0.0.1:${port}/analysis/context-pack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        filters: { severity: 'urgent' }
      })
    });
    assert.equal(invalidApiResponse.status, 400, 'expected API invalid filter to fail');

    await assert.rejects(
      () => handleToolCall('context_pack', {
        ...args,
        filters: { severity: 'urgent' }
      }),
      /Invalid risk filters/
    );
  } finally {
    server.close();
    if (typeof router.close === 'function') router.close();
  }
});

console.log('context pack risk filter parity test passed');
