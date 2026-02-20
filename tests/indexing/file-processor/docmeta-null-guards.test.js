#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildChunkPayload } from '../../../src/index/build/file-processor/assemble.js';
import { buildChunkEnrichment } from '../../../src/index/build/file-processor/process-chunks/enrichment.js';

applyTestEnv();

const noop = () => {};
const failFile = () => ({ reason: 'unexpected-failure' });

const chunk = {
  start: 0,
  end: 18,
  name: 'config.section',
  kind: 'ConfigSection'
};

const enrichment = buildChunkEnrichment({
  chunkMode: 'code',
  text: '{"section":{"enabled":true}}',
  chunkText: '"section":{"enabled":true}',
  chunk,
  chunkIndex: 0,
  activeLang: {
    id: 'config-test',
    extractDocMeta: () => null,
    flow: () => null
  },
  activeContext: {},
  languageOptions: {},
  fileRelations: null,
  callIndex: null,
  relationsEnabled: false,
  fileStructural: null,
  chunkLineCount: 1,
  chunkLanguageId: 'json',
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
  endLine: 1,
  totalLines: 1
});

assert.ok(!enrichment.skip, 'expected enrichment to succeed');
assert.deepEqual(enrichment.docmeta, {}, 'null docmeta from adapter should normalize to object');

const payload = buildChunkPayload({
  chunk: {
    ...chunk,
    startLine: 1,
    endLine: 1,
    chunkUid: 'uid-1',
    spanIndex: 0
  },
  rel: 'config/app.json',
  relKey: 'config/app.json',
  ext: '.json',
  effectiveExt: '.json',
  languageId: 'json',
  containerLanguageId: null,
  fileHash: null,
  fileHashAlgo: null,
  fileSize: 48,
  tokens: ['section', 'enabled', 'true'],
  tokenIds: [],
  identifierTokens: [],
  keywordTokens: [],
  operatorTokens: [],
  literalTokens: [],
  seq: ['section', 'enabled', 'true'],
  codeRelations: {},
  docmeta: null,
  stats: {},
  complexity: null,
  lint: null,
  preContext: null,
  postContext: null,
  minhashSig: [],
  commentFieldTokens: [],
  dictWords: new Set(),
  dictConfig: {},
  postingsConfig: {},
  emitFieldTokens: false,
  tokenMode: 'code',
  fileRelations: null,
  relationsEnabled: false,
  toolInfo: { tool: 'test', version: '0.0.0' },
  gitMeta: {},
  analysisPolicy: null
});

assert.ok(payload && typeof payload === 'object', 'expected payload object');
assert.deepEqual(payload.docmeta, {}, 'payload docmeta should normalize null to object');
assert.ok(Array.isArray(payload.preContext), 'preContext should normalize to array');
assert.ok(Array.isArray(payload.postContext), 'postContext should normalize to array');
assert.equal(payload.docmeta.doc, undefined, 'normalized docmeta should not create synthetic doc text');

console.log('docmeta null guard test passed');
