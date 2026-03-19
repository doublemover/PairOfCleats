#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import { loadJsonArrayArtifact } from '../../src/shared/artifact-io.js';
import {
  createAnalysisSurfaceHarness,
  normalizeSurfaceError
} from '../helpers/analysis-surface-parity.js';

applyTestEnv();

const normalizeRiskExplain = (payload) => ({
  chunkUid: payload?.chunk?.chunkUid || null,
  filters: payload?.filters || null,
  flowIds: Array.isArray(payload?.flows) ? payload.flows.map((entry) => entry.flowId) : [],
  partialFlowIds: Array.isArray(payload?.partialFlows) ? payload.partialFlows.map((entry) => entry.partialFlowId) : [],
  hasFlowWatchWindow: Boolean(payload?.flows?.[0]?.path?.watchByStep?.[0]),
  hasPartialWatchWindow: Boolean(payload?.partialFlows?.[0]?.path?.watchByStep?.[0]),
  statsStatus: payload?.stats?.status || null
});

const { fixtureRoot, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-risk-explain-parity',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
const partialFlows = await loadJsonArrayArtifact(codeDir, 'risk_partial_flows', { strict: false }).catch(() => []);
if ((!Array.isArray(flows) || flows.length === 0) && (!Array.isArray(partialFlows) || partialFlows.length === 0)) {
  console.log('risk flows unavailable; skipping risk explain parity test.');
  process.exit(0);
}

const flow = Array.isArray(flows) && flows.length ? flows[0] : null;
const partialFlow = Array.isArray(partialFlows) && partialFlows.length ? partialFlows[0] : null;
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid || partialFlow?.source?.chunkUid || partialFlow?.frontier?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

await withTemporaryEnv(env, async () => {
  const harness = await createAnalysisSurfaceHarness({ fixtureRoot, env: process.env });
  try {
    const args = {
      repoPath: fixtureRoot,
      chunk: chunkUid,
      max: 5,
      includePartialFlows: true,
      maxPartialFlows: 1,
      filters: {
        flowId: flow?.flowId,
        sourceRule: flow?.source?.ruleId,
        sinkRule: flow?.sink?.ruleId
      }
    };

    const cliRun = harness.runCli([
      'risk',
      'explain',
      '--json',
      '--index', codeDir,
      '--chunk', chunkUid,
      '--max', '5',
      '--includePartialFlows',
      '--maxPartialFlows', '1',
      '--flow-id', flow?.flowId || '',
      '--source-rule', flow?.source?.ruleId || '',
      '--sink-rule', flow?.sink?.ruleId || ''
    ]);
    assert.equal(cliRun.status, 0, `expected CLI risk explain call to succeed: ${cliRun.stderr}`);

    const apiResponse = await harness.runApi('/analysis/risk-explain', args);
    assert.equal(apiResponse.status, 200, 'expected filtered API risk explain request to succeed');
    assert.equal(apiResponse.parsed?.ok, true);

    const mcpPayload = await harness.runMcp('risk_explain', args);
    assert.equal(mcpPayload.ok, true, 'expected MCP risk explain request to succeed');

    const expected = normalizeRiskExplain(cliRun.parsed);
    assert.deepEqual(normalizeRiskExplain(apiResponse.parsed?.result), expected, 'expected API risk explain output to match CLI');
    assert.deepEqual(normalizeRiskExplain(mcpPayload.result), expected, 'expected MCP risk explain output to match CLI');

    const emptyArgs = {
      ...args,
      filters: { flowId: 'sha1:ffffffffffffffffffffffffffffffffffffffff' }
    };
    const emptyCli = harness.runCli([
      'risk',
      'explain',
      '--json',
      '--index', codeDir,
      '--chunk', chunkUid,
      '--max', '5',
      '--flow-id', 'sha1:ffffffffffffffffffffffffffffffffffffffff'
    ]);
    assert.equal(emptyCli.status, 0, 'expected CLI empty filtered risk explain run to succeed');
    assert.deepEqual(normalizeRiskExplain(emptyCli.parsed).flowIds, [], 'expected CLI empty filter result to stay non-fatal');

    const emptyApi = await harness.runApi('/analysis/risk-explain', emptyArgs);
    assert.equal(emptyApi.status, 200, 'expected API empty filtered risk explain run to stay non-fatal');
    assert.deepEqual(normalizeRiskExplain(emptyApi.parsed?.result).flowIds, [], 'expected API empty filter result to stay non-fatal');

    const emptyMcp = await harness.runMcp('risk_explain', emptyArgs);
    assert.equal(emptyMcp.ok, true, 'expected MCP empty filtered risk explain run to stay non-fatal');
    assert.deepEqual(normalizeRiskExplain(emptyMcp.result).flowIds, [], 'expected MCP empty filter result to stay non-fatal');

    const invalidCli = harness.runCli([
      'risk',
      'explain',
      '--json',
      '--index', codeDir,
      '--chunk', chunkUid,
      '--includePartialFlows',
      '--severity', 'urgent'
    ]);
    assert.equal(invalidCli.status, 1, 'expected CLI invalid filter to fail');
    assert.deepEqual(normalizeSurfaceError(invalidCli.parsed), {
      code: 'INVALID_REQUEST',
      reason: 'invalid_risk_filters'
    });

    const invalidApi = await harness.runApi('/analysis/risk-explain', {
      repoPath: fixtureRoot,
      chunk: chunkUid,
      includePartialFlows: true,
      filters: { severity: 'urgent' }
    });
    assert.equal(invalidApi.status, 400, 'expected API invalid filter to fail');
    assert.deepEqual(normalizeSurfaceError(invalidApi.parsed), {
      code: 'INVALID_REQUEST',
      reason: 'invalid_risk_filters'
    });

    const invalidMcp = await harness.runMcp('risk_explain', {
      repoPath: fixtureRoot,
      chunk: chunkUid,
      includePartialFlows: true,
      filters: { severity: 'urgent' }
    });
    assert.equal(invalidMcp.ok, false, 'expected MCP invalid filter to fail');
    assert.deepEqual(normalizeSurfaceError(invalidMcp.error), {
      code: 'INVALID_REQUEST',
      reason: 'invalid_risk_filters'
    });
  } finally {
    await harness.close();
  }
});

console.log('risk explain surface parity test passed');
