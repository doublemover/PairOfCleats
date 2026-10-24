#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskExplanationModel } from '../../src/shared/risk-explain-model.js';
import { buildRiskExplanationPresentation, getRiskExplanationSurfaceOptions,
  renderRiskExplanation, renderRiskExplanationJson } from '../../src/retrieval/output/risk-explain.js';

for (const size of [0, 1, 20]) {
  let reads = 0;
  const details = { file: 'source.js', startLine: 1, calleeRaw: 'next' };
  Object.defineProperty(details, 'excerpt', { enumerable: true, get() { reads++; return 'next()'; } });
  const model = buildRiskExplanationModel({ flows: Array.from({ length: size }, (_, index) => ({
    flowId: 'flow-' + index, confidence: 0.8, source: { chunkUid: 'root' }, sink: { chunkUid: 'target' },
    path: { nodes: [{ type: 'chunk', chunkUid: 'root' }], callSiteIdsByStep: [['call']] },
    evidence: { callSitesByStep: [[{ callSiteId: 'call', details }]] }
  })) });
  const options = getRiskExplanationSurfaceOptions('standalone', { maxFlows: 3, maxEvidencePerFlow: 1 });
  const json = renderRiskExplanationJson(model, options);
  const markdown = renderRiskExplanation(model, options);
  reads = 0;
  const jsonOnly = buildRiskExplanationPresentation(model, { ...options, surface: 'standalone', format: 'json' });
  const jsonReads = reads;
  assert.deepEqual(jsonOnly.json, json); assert.equal(jsonOnly.markdown, null);
  reads = 0;
  const mdOnly = buildRiskExplanationPresentation(model, { ...options, surface: 'standalone', format: 'md' });
  const markdownReads = reads;
  assert.equal(mdOnly.markdown, markdown); assert.equal(mdOnly.json, null);
  reads = 0;
  const both = buildRiskExplanationPresentation(model, { ...options, surface: 'standalone' });
  assert.deepEqual(both.json, json); assert.equal(both.markdown, markdown);
  assert.equal(reads, jsonReads, 'intentional dual output shares its common projection');
  if (size) assert.ok(markdownReads < jsonReads, 'Markdown does not traverse a discarded SARIF companion');
}
console.log('risk explanation computes only selected formats and shares common projection');
