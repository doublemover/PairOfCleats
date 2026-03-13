#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildRiskExplanationPresentationFromRiskSlice,
  buildRiskExplanationPresentationFromStandalone,
  getRiskExplanationSurfaceOptions
} from '../../../src/retrieval/output/risk-explain.js';

const standaloneDefaults = getRiskExplanationSurfaceOptions('standalone');
assert.equal(standaloneDefaults.title, 'Risk Explain');
assert.equal(standaloneDefaults.includeSubject, true);
assert.equal(standaloneDefaults.includeFilters, true);
assert.equal(standaloneDefaults.maxFlows, 20);
assert.equal(standaloneDefaults.maxPartialFlows, 20);
assert.equal(standaloneDefaults.maxEvidencePerFlow, 20);

const contextPackDefaults = getRiskExplanationSurfaceOptions('contextPack');
assert.equal(contextPackDefaults.title, 'Risk');
assert.equal(contextPackDefaults.includeSubject, false);
assert.equal(contextPackDefaults.includeAnchor, false);
assert.equal(contextPackDefaults.includeFilters, true);
assert.equal(contextPackDefaults.maxFlows, 5);
assert.equal(contextPackDefaults.maxPartialFlows, 5);
assert.equal(contextPackDefaults.maxEvidencePerFlow, 3);

const standalonePresentation = buildRiskExplanationPresentationFromStandalone({
  chunk: {
    chunkUid: 'chunk-risk',
    file: 'src/app.ts',
    name: 'risky',
    kind: 'function'
  },
  summary: {
    totals: {
      sources: 1,
      sinks: 1,
      sanitizers: 0,
      localFlows: 0
    },
    signals: {
      sources: [],
      sinks: [],
      sanitizers: [],
      localFlows: []
    }
  },
  stats: {
    status: 'ok',
    counts: {
      flowsEmitted: 1,
      partialFlowsEmitted: 0,
      summariesEmitted: 1,
      uniqueCallSitesReferenced: 1
    },
    capsHit: []
  },
  flows: []
}, {
  surface: 'standalone'
});
assert.equal(standalonePresentation.json.subject.chunkUid, 'chunk-risk');
assert.match(standalonePresentation.markdown, /Risk Explain/);

const contextPackPresentation = buildRiskExplanationPresentationFromRiskSlice({
  summary: {
    chunkUid: 'chunk-risk',
    file: 'src/app.ts',
    symbol: {
      name: 'risky',
      kind: 'function'
    },
    totals: {
      sources: 1,
      sinks: 1,
      sanitizers: 0,
      localFlows: 0
    }
  },
  analysisStatus: {
    status: 'ok',
    code: 'ok'
  },
  flows: []
}, {
  surface: 'contextPack',
  subject: {
    chunkUid: 'chunk-risk',
    file: 'src/app.ts',
    name: 'risky',
    kind: 'function'
  }
});
assert.equal(contextPackPresentation.json.subject.chunkUid, 'chunk-risk');
assert.equal(contextPackPresentation.json.subject.name, 'risky');
assert.match(contextPackPresentation.markdown, /^Risk\n/m);
assert.doesNotMatch(contextPackPresentation.markdown, /- chunkUid:/, 'context-pack surface should keep subject hidden in markdown by default');

console.log('risk explain surface defaults test passed');
