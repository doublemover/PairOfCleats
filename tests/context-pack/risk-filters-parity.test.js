#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { applyTestEnv, withTemporaryEnv } from '../helpers/test-env.js';
import { ensureFixtureIndex } from '../helpers/fixture-index.js';
import {
  loadJsonArrayArtifact,
  loadPiecesManifest,
  resolveArtifactPresence
} from '../../src/shared/artifact-io.js';
import {
  createAnalysisSurfaceHarness,
  normalizeSurfaceError
} from '../helpers/analysis-surface-parity.js';

applyTestEnv();

const normalizeRisk = (payload) => ({
  present: payload?.risk != null,
  status: payload?.risk?.status || null,
  degraded: payload?.risk?.degraded ?? null,
  analysisStatus: payload?.risk?.analysisStatus?.code || null,
  artifactStatus: payload?.risk?.analysisStatus?.artifactStatus || null,
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
  const harness = await createAnalysisSurfaceHarness({ fixtureRoot, env: process.env });
  try {
    const seed = `chunk:${chunkUid}`;
    const baseArgs = {
      repoPath: fixtureRoot,
      seed,
      hops: 0
    };

    const noRiskCli = harness.runCli([
      'context-pack',
      '--json',
      '--repo', fixtureRoot,
      '--seed', seed,
      '--hops', '0'
    ]);
    assert.equal(noRiskCli.status, 0, `expected CLI context-pack without risk to succeed: ${noRiskCli.stderr}`);

    const noRiskApi = await harness.runApi('/analysis/context-pack', baseArgs);
    assert.equal(noRiskApi.status, 200, 'expected API context-pack without risk to succeed');

    const noRiskMcp = await harness.runMcp('context_pack', baseArgs);
    assert.equal(noRiskMcp.ok, true, 'expected MCP context-pack without risk to succeed');

    assert.deepEqual(normalizeRisk(noRiskCli.parsed), {
      present: false,
      status: null,
      degraded: null,
      analysisStatus: null,
      artifactStatus: null,
      filters: null,
      flowIds: [],
      partialFlowIds: []
    });
    assert.deepEqual(normalizeRisk(noRiskApi.parsed?.result), normalizeRisk(noRiskCli.parsed));
    assert.deepEqual(normalizeRisk(noRiskMcp.result), normalizeRisk(noRiskCli.parsed));

    const args = {
      ...baseArgs,
      includeRisk: true,
      includeRiskPartialFlows: true,
      filters: {
        flowId: flow?.flowId,
        sourceRule: flow?.source?.ruleId,
        sinkRule: flow?.sink?.ruleId
      }
    };

    const cliRun = harness.runCli([
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

    const apiResponse = await harness.runApi('/analysis/context-pack', args);
    assert.equal(apiResponse.status, 200, 'expected filtered context-pack API request to succeed');
    assert.equal(apiResponse.parsed?.ok, true);

    const mcpPayload = await harness.runMcp('context_pack', args);
    assert.equal(mcpPayload.ok, true, 'expected MCP context-pack request to succeed');

    const expected = normalizeRisk(cliRun.parsed);
    assert.deepEqual(normalizeRisk(apiResponse.parsed?.result), expected, 'expected API context-pack risk output to match CLI');
    assert.deepEqual(normalizeRisk(mcpPayload.result), expected, 'expected MCP context-pack risk output to match CLI');

    const emptyArgs = {
      ...args,
      filters: { flowId: 'sha1:ffffffffffffffffffffffffffffffffffffffff' }
    };
    const emptyCli = harness.runCli([
      'context-pack',
      '--json',
      '--repo', fixtureRoot,
      '--seed', emptyArgs.seed,
      '--hops', String(emptyArgs.hops),
      '--includeRisk',
      '--flow-id', 'sha1:ffffffffffffffffffffffffffffffffffffffff'
    ]);
    assert.equal(emptyCli.status, 0, 'expected CLI empty filter result to stay non-fatal');
    assert.deepEqual(normalizeRisk(emptyCli.parsed).flowIds, [], 'expected CLI empty filter result to stay non-fatal');

    const emptyApiResponse = await harness.runApi('/analysis/context-pack', emptyArgs);
    assert.equal(emptyApiResponse.status, 200, 'expected empty filtered context-pack API request to stay non-fatal');
    assert.deepEqual(normalizeRisk(emptyApiResponse.parsed?.result).flowIds, [], 'expected API empty filter result to stay non-fatal');

    const emptyMcpPayload = await harness.runMcp('context_pack', emptyArgs);
    assert.equal(emptyMcpPayload.ok, true, 'expected MCP empty filter result to stay non-fatal');
    assert.deepEqual(normalizeRisk(emptyMcpPayload.result).flowIds, [], 'expected MCP empty filter result to stay non-fatal');

    const snakeCaseApiResponse = await harness.runApi('/analysis/context-pack', {
      ...args,
      filters: {
        flow_id: flow?.flowId,
        source_rule: flow?.source?.ruleId,
        sink_rule: flow?.sink?.ruleId
      }
    });
    assert.equal(snakeCaseApiResponse.status, 200, 'expected snake_case API context-pack filters to succeed');
    assert.deepEqual(
      normalizeRisk(snakeCaseApiResponse.parsed?.result),
      expected,
      'expected snake_case API filters to match canonical filtered risk output'
    );

    const manifest = loadPiecesManifest(codeDir, { strict: true });
    const callSitesPresence = resolveArtifactPresence(codeDir, 'call_sites', { manifest, strict: false });
    const callSitesPath = callSitesPresence.paths?.[0] || null;
    assert.ok(callSitesPath, 'expected fixture index to include call_sites artifact');
    const manifestPath = `${codeDir}\\pieces\\manifest.json`;
    const manifestText = await fs.readFile(manifestPath, 'utf8');
    const manifestJson = JSON.parse(manifestText);
    const manifestBody = manifestJson?.fields && typeof manifestJson.fields === 'object'
      ? manifestJson.fields
      : manifestJson;
    manifestBody.pieces = (Array.isArray(manifestBody?.pieces) ? manifestBody.pieces : [])
      .filter((entry) => !String(entry?.name || '').startsWith('call_sites'));
    await fs.writeFile(manifestPath, `${JSON.stringify(manifestJson, null, 2)}\n`, 'utf8');
    try {
      const degradedArgs = {
        ...baseArgs,
        includeRisk: true,
        includeGraph: false,
        includeImports: false,
        includeUsages: false,
        includeCallersCallees: false
      };
      const degradedCli = harness.runCli([
        'context-pack',
        '--json',
        '--repo', fixtureRoot,
        '--seed', degradedArgs.seed,
        '--hops', String(degradedArgs.hops),
        '--includeRisk',
        '--includeGraph=false',
        '--includeImports=false',
        '--includeUsages=false',
        '--includeCallersCallees=false'
      ]);
      assert.equal(degradedCli.status, 0, 'expected degraded CLI context-pack call to stay non-fatal');

      const degradedApi = await harness.runApi('/analysis/context-pack', degradedArgs);
      assert.equal(degradedApi.status, 200, 'expected degraded API context-pack call to stay non-fatal');

      const degradedMcp = await harness.runMcp('context_pack', degradedArgs);
      assert.equal(degradedMcp.ok, true, 'expected degraded MCP context-pack call to stay non-fatal');

      const degradedExpected = normalizeRisk(degradedCli.parsed);
      assert.equal(degradedExpected.status, 'degraded');
      assert.equal(degradedExpected.degraded, true);
      assert.equal(degradedExpected.artifactStatus?.callSites, 'missing');
      assert.deepEqual(normalizeRisk(degradedApi.parsed?.result), degradedExpected);
      assert.deepEqual(normalizeRisk(degradedMcp.result), degradedExpected);
    } finally {
      await fs.writeFile(manifestPath, manifestText, 'utf8');
    }

    const invalidCli = harness.runCli([
      'context-pack',
      '--json',
      '--repo', fixtureRoot,
      '--seed', args.seed,
      '--hops', String(args.hops),
      '--includeRisk',
      '--severity', 'urgent'
    ]);
    assert.equal(invalidCli.status, 1, 'expected CLI invalid filter to fail');
    assert.deepEqual(normalizeSurfaceError(invalidCli.parsed), {
      code: 'INVALID_REQUEST',
      reason: 'invalid_risk_filters'
    });

    const invalidApiResponse = await harness.runApi('/analysis/context-pack', {
      ...args,
      filters: { severity: 'urgent' }
    });
    assert.equal(invalidApiResponse.status, 400, 'expected API invalid filter to fail');
    assert.deepEqual(normalizeSurfaceError(invalidApiResponse.parsed), {
      code: 'INVALID_REQUEST',
      reason: 'invalid_risk_filters'
    });

    const invalidMcp = await harness.runMcp('context_pack', {
      ...args,
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

console.log('context pack risk filter parity test passed');
