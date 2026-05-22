#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  createDisabledAnalysisPolicy,
  createProcessChunksFixtureContext,
  processFixtureChunks
} from './process-chunks-fixture.js';

ensureTestingEnv(process.env);

const text = 'function a() { return 1; }\nfunction b() { return 2; }\nfunction c() { return 3; }\nfunction d() { return 4; }\n';
const perfRows = [];
const { context, logs, lineIndex } = createProcessChunksFixtureContext({
  text,
  rel: 'src/heavy-file.js',
  lang: { id: 'javascript', extractDocMeta: () => ({}) },
  languageOptions: {
    heavyFile: {
      maxChunks: 2,
      skipTokenizationMaxChunks: 2,
      skipTokenizationCoalesceMaxChunks: 1
    }
  },
  tokenizeEnabled: true,
  riskAnalysisEnabled: false,
  riskConfig: {},
  typeInferenceEnabled: false,
  analysisPolicy: createDisabledAnalysisPolicy(),
  perfEventLogger: {
    enabled: true,
    emit: (event, payload) => perfRows.push({ event, ...(payload || {}) })
  }
});
const offsets = [
  0,
  lineIndex[1],
  lineIndex[2],
  lineIndex[3],
  text.length
];
const sc = [
  { start: offsets[0], end: offsets[1], segment: { languageId: 'javascript', segmentUid: 'seg-1' }, kind: 'code', name: 'a' },
  { start: offsets[1], end: offsets[2], segment: { languageId: 'javascript', segmentUid: 'seg-2' }, kind: 'code', name: 'b' },
  { start: offsets[2], end: offsets[3], segment: { languageId: 'javascript', segmentUid: 'seg-3' }, kind: 'code', name: 'c' },
  { start: offsets[3], end: offsets[4], segment: { languageId: 'javascript', segmentUid: 'seg-4' }, kind: 'code', name: 'd' }
];
const result = await processFixtureChunks(context, {
  sc,
  totalLines: lineIndex.length || 1
});

assert.equal(result.chunks.length, 1, 'expected heavy-file coalescing to reduce chunks');
assert.ok(
  !logs.some((line) => line.includes('[perf] heavy-file')),
  'expected heavy-file console logs to be suppressed when perfEventLogger is present'
);
assert.equal(perfRows.length, 1, 'expected one perf event row');
assert.equal(perfRows[0].event, 'perf.heavy_file_policy');
assert.equal(perfRows[0].file, 'src/heavy-file.js');
assert.equal(perfRows[0].sourceChunks, 4);
assert.equal(perfRows[0].workingChunks, 1);
assert.equal(perfRows[0].coalesced, true);
assert.equal(perfRows[0].heavyDownshift, true);
assert.equal(perfRows[0].skipTokenization, true);

console.log('heavy file perf event filelog test passed');
