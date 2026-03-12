#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getCombinedOutput } from '../../helpers/stdio.js';

applyTestEnv();

const { root, codeDir, env } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-risk-explain',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
const partialFlows = await loadJsonArrayArtifact(codeDir, 'risk_partial_flows', { strict: false }).catch(() => []);
if ((!Array.isArray(flows) || flows.length === 0) && (!Array.isArray(partialFlows) || partialFlows.length === 0)) {
  console.log('risk flows unavailable; skipping risk explain CLI test.');
  process.exit(0);
}

const flow = Array.isArray(flows) && flows.length ? flows[0] : null;
const partialFlow = Array.isArray(partialFlows) && partialFlows.length ? partialFlows[0] : null;
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid || partialFlow?.source?.chunkUid || partialFlow?.frontier?.chunkUid;
assert.ok(chunkUid, 'expected flow to include a chunkUid');

const binPath = path.join(root, 'bin', 'pairofcleats.js');
const result = spawnSync(
  process.execPath,
  [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '1'],
  { encoding: 'utf8', env }
);
if (result.status !== 0) {
  console.error('risk explain CLI failed');
  process.exit(result.status ?? 1);
}

const output = getCombinedOutput(result, { trim: true });
assert.ok(output.includes(flow.flowId), 'expected output to include flowId');
assert.ok(output.includes('src/index.js'), 'expected output to include fixture file path');

const filteredResult = spawnSync(
  process.execPath,
  [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '5', '--flow-id', flow.flowId],
  { encoding: 'utf8', env }
);
assert.equal(filteredResult.status, 0, 'expected filtered risk explain run to succeed');
const filteredOutput = getCombinedOutput(filteredResult, { trim: true });
assert.ok(filteredOutput.includes(flow.flowId), 'expected filtered output to include requested flow');

const jsonResult = spawnSync(
  process.execPath,
  [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '1', '--json', '--includePartialFlows', '--maxPartialFlows', '2'],
  { encoding: 'utf8', env }
);
assert.equal(jsonResult.status, 0, 'expected JSON risk explain run to succeed');
const jsonPayload = JSON.parse(getCombinedOutput(jsonResult, { trim: true }));
assert.equal(jsonPayload.rendered.flowSelection.totalFlows, 1, 'expected rendered JSON risk summary');
assert.equal(jsonPayload.rendered.partialFlowSelection.totalPartialFlows, 0, 'expected no partial flows in simple fixture');
assert.deepEqual(jsonPayload.rendered.partialFlows, [], 'expected empty partial flows array in simple fixture');
if (flow) {
  assert.equal(jsonPayload.rendered.sarif.runs[0].results[0].properties.pairOfCleats.flowId, flow.flowId, 'expected SARIF export to preserve flowId');
}

const emptyResult = spawnSync(
  process.execPath,
  [binPath, 'risk', 'explain', '--index', codeDir, '--chunk', chunkUid, '--max', '5', '--flow-id', 'sha1:missing'],
  { encoding: 'utf8', env }
);
assert.equal(emptyResult.status, 0, 'expected empty filtered risk explain run to succeed');
assert.match(getCombinedOutput(emptyResult, { trim: true }), /No interprocedural flows found/, 'expected empty filtered result message');

console.log('risk explain CLI test passed');
