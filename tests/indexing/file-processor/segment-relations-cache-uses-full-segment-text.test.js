#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildChunkEnrichment } from '../../../src/index/build/file-processor/process-chunks/index.js';

applyTestEnv();

/**
 * No-op telemetry hook used by chunk enrichment test scaffolding.
 *
 * @returns {void}
 */
const noop = () => {};
/**
 * Stubbed failure handler; this test expects enrichment to remain on success path.
 *
 * @returns {{reason:string}}
 */
const failFile = () => ({ reason: 'unexpected-failure' });

const text = [
  "import A from './a';",
  'function alpha() {',
  '  beta();',
  '}',
  "import B from './b';",
  'function beta() {',
  '  gamma();',
  '}'
].join('\n');

const splitOffset = text.indexOf("import B from './b';");
const sharedSegment = {
  segmentId: 'seg-1',
  start: 0,
  end: text.length
};
const chunkOne = {
  start: 0,
  end: splitOffset - 1,
  name: 'alpha',
  kind: 'FunctionDeclaration',
  segment: sharedSegment
};
const chunkTwo = {
  start: splitOffset,
  end: text.length,
  name: 'beta',
  kind: 'FunctionDeclaration',
  segment: sharedSegment
};

let buildRelationsCalls = 0;
/**
 * Language adapter stub that records whether segment-level relation extraction
 * is computed once and then reused from cache for sibling chunks.
 */
const activeLang = {
  id: 'javascript',
  extractDocMeta: () => ({}),
  buildRelations: ({ text: relationText }) => {
    buildRelationsCalls += 1;
    return {
      imports: [
        ...(relationText.includes("import A from './a';") ? ['./a'] : []),
        ...(relationText.includes("import B from './b';") ? ['./b'] : [])
      ],
      calls: [
        ...(relationText.includes('beta();') ? [['alpha', 'beta']] : []),
        ...(relationText.includes('gamma();') ? [['beta', 'gamma']] : [])
      ],
      callDetails: [
        ...(relationText.includes('beta();') ? [{ caller: 'alpha', callee: 'beta' }] : []),
        ...(relationText.includes('gamma();') ? [{ caller: 'beta', callee: 'gamma' }] : [])
      ]
    };
  },
  flow: () => null
};

const commonInput = {
  chunkMode: 'code',
  text,
  activeLang,
  activeContext: {},
  languageOptions: {},
  fileRelations: null,
  callIndex: null,
  relationsEnabled: true,
  fileStructural: null,
  chunkLineCount: 4,
  chunkLanguageId: 'javascript',
  resolvedTypeInferenceEnabled: false,
  resolvedRiskAnalysisEnabled: false,
  riskConfig: {},
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  addSettingMetric: noop,
  addEnrichDuration: noop,
  updateCrashStage: noop,
  failFile,
  diagnostics: [],
  startLine: 1,
  endLine: 8,
  totalLines: 8
};

const segmentRelationsCache = new Map();
const one = buildChunkEnrichment({
  ...commonInput,
  chunk: chunkOne,
  chunkText: text.slice(chunkOne.start, chunkOne.end),
  chunkIndex: 0,
  segmentRelationsCache
});
const two = buildChunkEnrichment({
  ...commonInput,
  chunk: chunkTwo,
  chunkText: text.slice(chunkTwo.start, chunkTwo.end),
  chunkIndex: 1,
  segmentRelationsCache
});

assert.ok(!one.skip, 'first chunk enrichment should succeed');
assert.ok(!two.skip, 'second chunk enrichment should succeed');
assert.equal(buildRelationsCalls, 1, 'segment relation cache should build once per segment id');

assert.deepEqual(
  one.codeRelations.imports?.slice().sort(),
  ['./a', './b'],
  'first chunk should receive imports built from full segment text'
);
assert.deepEqual(
  two.codeRelations.imports?.slice().sort(),
  ['./a', './b'],
  'second chunk should receive imports built from full segment text'
);
assert.deepEqual(two.codeRelations.calls, [['beta', 'gamma']], 'second chunk should retain its call relations from cached full-segment build');
assert.deepEqual(two.codeRelations.callDetails, [{ caller: 'beta', callee: 'gamma' }], 'second chunk should retain its call details from cached full-segment build');

console.log('segment relations cache full-segment text test passed');
