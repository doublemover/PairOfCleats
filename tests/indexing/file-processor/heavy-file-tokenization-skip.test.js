#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import {
  createDisabledAnalysisPolicy,
  createProcessChunksFixtureContext,
  processFixtureChunks
} from './process-chunks-fixture.js';

ensureTestingEnv(process.env);

const text = 'function heavy_file_symbol() { return 42; }\n';
const { context, logs } = createProcessChunksFixtureContext({
  text,
  rel: 'src/heavy.js',
  segmentUid: 'seg-heavy',
  segmentName: 'heavy_file_symbol',
  lang: { id: 'javascript', extractDocMeta: () => ({}) },
  languageOptions: {
    heavyFile: {
      maxChunks: 1,
      skipTokenizationMaxChunks: 1,
      skipTokenizationCoalesceMaxChunks: 1
    }
  },
  tokenizeEnabled: true,
  riskAnalysisEnabled: false,
  riskConfig: {},
  typeInferenceEnabled: false,
  analysisPolicy: createDisabledAnalysisPolicy()
});
const result = await processFixtureChunks(context);

assert.equal(result.chunks.length, 1, 'expected one output chunk');
assert.equal(result.chunks[0].tokens.length, 0, 'expected tokenization skip to emit no tokens');
assert.ok(
  logs.some((line) => line.includes('[perf] heavy-file tokenization skipped for src/heavy.js.')),
  'expected heavy-file tokenization skip log'
);

console.log('heavy file tokenization skip test passed');
