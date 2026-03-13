#!/usr/bin/env node
import { applyTestEnv } from '../../../helpers/test-env.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ensureFixtureIndex } from '../../../helpers/fixture-index.js';
import { loadJsonArrayArtifactSync, MAX_JSON_BYTES } from '../../../../src/shared/artifact-io.js';

applyTestEnv();

const { codeDir } = await ensureFixtureIndex({
  fixtureName: 'risk-interprocedural/js-simple',
  cacheName: 'risk-interprocedural-js-simple-partial-artifacts',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const hasJsonl = (base) => {
  const jsonl = path.join(codeDir, `${base}.jsonl`);
  const meta = path.join(codeDir, `${base}.meta.json`);
  return fs.existsSync(jsonl) || fs.existsSync(`${jsonl}.gz`) || fs.existsSync(`${jsonl}.zst`) || fs.existsSync(meta);
};

assert.ok(hasJsonl('risk_summaries'), 'risk_summaries jsonl missing');
assert.ok(hasJsonl('risk_flows'), 'risk_flows jsonl missing');
assert.ok(hasJsonl('risk_partial_flows'), 'risk_partial_flows jsonl missing');
assert.ok(fs.existsSync(path.join(codeDir, 'risk_interprocedural_stats.json')), 'risk_interprocedural_stats.json missing');

const summariesMeta = path.join(codeDir, 'risk_summaries.meta.json');
if (fs.existsSync(summariesMeta)) {
  const meta = JSON.parse(fs.readFileSync(summariesMeta, 'utf8'));
  const parts = Array.isArray(meta.parts) ? meta.parts : [];
  assert.ok(parts.length > 0, 'risk_summaries meta should list parts');
  for (const part of parts) {
    const rel = typeof part === 'string' ? part : part.path;
    assert.ok(rel, 'risk_summaries part path missing');
    assert.ok(fs.existsSync(path.join(codeDir, rel)), `risk_summaries part missing: ${rel}`);
  }
}

const flowsMeta = path.join(codeDir, 'risk_flows.meta.json');
if (fs.existsSync(flowsMeta)) {
  const meta = JSON.parse(fs.readFileSync(flowsMeta, 'utf8'));
  const parts = Array.isArray(meta.parts) ? meta.parts : [];
  assert.ok(parts.length > 0, 'risk_flows meta should list parts');
  for (const part of parts) {
    const rel = typeof part === 'string' ? part : part.path;
    assert.ok(rel, 'risk_flows part path missing');
    assert.ok(fs.existsSync(path.join(codeDir, rel)), `risk_flows part missing: ${rel}`);
  }
}

const partialFlowsMeta = path.join(codeDir, 'risk_partial_flows.meta.json');
if (fs.existsSync(partialFlowsMeta)) {
  const meta = JSON.parse(fs.readFileSync(partialFlowsMeta, 'utf8'));
  const parts = Array.isArray(meta.parts) ? meta.parts : [];
  assert.ok(parts.length > 0, 'risk_partial_flows meta should list parts');
  for (const part of parts) {
    const rel = typeof part === 'string' ? part : part.path;
    assert.ok(rel, 'risk_partial_flows part path missing');
    assert.ok(fs.existsSync(path.join(codeDir, rel)), `risk_partial_flows part missing: ${rel}`);
  }
}

const firstJsonlRow = (base) => {
  try {
    const rows = loadJsonArrayArtifactSync(codeDir, base, {
      maxBytes: MAX_JSON_BYTES,
      strict: true
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch {
    return null;
  }
};

const firstFlow = firstJsonlRow('risk_flows');
if (firstFlow) {
  assert.ok(Array.isArray(firstFlow?.path?.watchByStep), 'risk_flows path.watchByStep missing');
  assert.equal(firstFlow.path.watchByStep.length, firstFlow.path.callSiteIdsByStep.length, 'risk_flows watchByStep length mismatch');
}

const firstPartialFlow = firstJsonlRow('risk_partial_flows');
if (firstPartialFlow) {
  assert.ok(Array.isArray(firstPartialFlow?.path?.watchByStep), 'risk_partial_flows path.watchByStep missing');
  assert.equal(firstPartialFlow.path.watchByStep.length, firstPartialFlow.path.callSiteIdsByStep.length, 'risk_partial_flows watchByStep length mismatch');
}

console.log('risk interprocedural artifacts written test passed');
