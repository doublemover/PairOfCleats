#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildRiskExplanationPresentationFromStandalone } from '../../src/retrieval/output/risk-explain.js';

const key = Symbol.for('poc.test.risk-explain-artifacts');
const state = { fail: null, missing: null, stats: { status: 'complete', counts: { flowsEmitted: 4, partialFlowsEmitted: 3 } },
  flows: Array.from({ length: 3 }, (_, index) => ({ flowId: 'flow-' + index, confidence: 1 - index / 10,
    source: { chunkUid: 'root' }, sink: { chunkUid: 'other' }, path: { chunkUids: ['root', 'other'], callSiteIdsByStep: [['call']] } })),
  partials: Array.from({ length: 3 }, (_, index) => ({ partialFlowId: 'partial-' + index,
    source: { chunkUid: 'root' }, frontier: { chunkUid: 'other' }, path: { chunkUids: ['root'], callSiteIdsByStep: [] } })) };
globalThis[key] = state;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context);
    if (context.parentURL?.endsWith('/tools/analysis/explain-risk.js')) {
      if (result.url.endsWith('/src/shared/artifact-io/loaders.js')) return { url: 'poc:risk-loaders', shortCircuit: true };
      if (result.url.endsWith('/src/shared/artifact-io/manifest.js')) return { url: 'poc:risk-manifest', shortCircuit: true };
    }
    return result;
  },
  load(url, context, next) {
    const access = 'const state=globalThis[Symbol.for("poc.test.risk-explain-artifacts")];';
    if (url === 'poc:risk-manifest') return { format: 'module', shortCircuit: true, source: access + `
      export const loadPiecesManifest=()=>({});
      export const resolveArtifactPresence=(dir,name)=>({format:'json',missingPaths:state.missing===name?['absent']:[]});` };
    if (url === 'poc:risk-loaders') return { format: 'module', shortCircuit: true, source: access + `
      export const loadChunkMeta=async()=>[{chunkUid:'root',file:'root.js',name:'root'}];
      const load=name=>{if(state.fail===name)throw Object.assign(new Error('private path must not leak'),{code:'ERR_ARTIFACT_INVALID'});
        return name==='risk_interprocedural_stats'?state.stats:name==='risk_flows'?state.flows:
          name==='risk_partial_flows'?state.partials:name==='call_sites'?[{callSiteId:'call',file:'root.js',startLine:1,calleeRaw:'next'}]:[];};
      export const loadJsonArrayArtifact=async(dir,name)=>load(name);
      export const loadJsonObjectArtifact=async(dir,name)=>load(name);` };
    return next(url, context);
  }
});
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-risk-explain-'));
try {
  const { buildRiskExplainPayload, runRiskExplainCli } = await import('../../tools/analysis/explain-risk.js');
  const input = { indexDir: root, chunkUid: 'root', max: 1, includePartialFlows: true, maxPartialFlows: 1 };
  const payload = await buildRiskExplainPayload(input);
  assert.equal(payload.flows.length, 1); assert.equal(payload.partialFlows.length, 1);
  const two = await buildRiskExplainPayload({ ...input, max: 2 });
  const smaller = buildRiskExplanationPresentationFromStandalone(two, { maxFlows: 1 });
  assert.equal(smaller.json.flowSelection.totalFlows, 3);
  assert.equal(smaller.json.flowSelection.shownFlows, 1);
  assert.equal(smaller.json.flowSelection.omittedFlows, 2, 'query and presentation caps compose without counting omissions twice');
  for (const cap of [1, 20]) {
    const rendered = buildRiskExplanationPresentationFromStandalone(payload, { maxFlows: cap, maxPartialFlows: cap });
    assert.equal(rendered.json.flowSelection.totalFlows, 3);
    assert.equal(rendered.json.flowSelection.omittedFlows, 2);
    assert.equal(rendered.json.partialFlowSelection.totalPartialFlows, 3);
    assert.equal(rendered.json.sarif.runs[0].properties.pairOfCleats.flowSelection.omittedFlows, 2);
    assert.equal(rendered.json.sarif.runs[0].properties.pairOfCleats.partialFlowSelection.omittedPartialFlows, 2);
    assert.match(rendered.markdown, /omitted 2 additional flow/);
  }
  state.flows = []; state.partials = [];
  for (const failure of ['risk_flows', 'risk_interprocedural_stats']) {
    state.fail = failure;
    const failed = await buildRiskExplainPayload(input);
    assert.equal(failed.analysisStatus.status, 'unavailable');
    assert.ok(failed.warnings.some(warning => warning.artifact === failure));
    assert.doesNotMatch(JSON.stringify(failed.warnings), /private path/);
  }
  state.fail = null; state.missing = 'risk_flows';
  assert.equal((await buildRiskExplainPayload(input)).artifactStatus.flows, 'missing');
  state.missing = null; state.stats = { status: 'disabled', reason: 'disabled_by_config' };
  let stdout = ''; const originalLog = console.log;
  try {
    console.log = text => { stdout += String(text) + '\n'; };
    await runRiskExplainCli(['--index', root, '--chunk', 'root', '--format', 'md']);
  } finally { console.log = originalLog; }
  assert.match(stdout, /status: disabled/);
  assert.doesNotMatch(stdout, /No interprocedural flows found/);
  state.stats = { status: 'complete', counts: { flowsEmitted: 0 } };
  const empty = await buildRiskExplainPayload(input);
  assert.equal(empty.analysisStatus.status, 'complete'); assert.deepEqual(empty.warnings, []);
} finally { hooks.deregister(); delete globalThis[key]; await fs.rm(root, { recursive: true, force: true }); }
console.log('risk explain preserves population omissions and artifact availability');
