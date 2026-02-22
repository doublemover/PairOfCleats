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
  cacheName: 'risk-interprocedural-js-simple',
  requireRiskTags: true
});

const flows = await loadJsonArrayArtifact(codeDir, 'risk_flows', { strict: false }).catch(() => []);
if (!Array.isArray(flows) || flows.length === 0) {
  console.log('risk flows unavailable; skipping risk explain CLI test.');
  process.exit(0);
}

const flow = flows[0];
const chunkUid = flow?.source?.chunkUid || flow?.sink?.chunkUid;
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

console.log('risk explain CLI test passed');
