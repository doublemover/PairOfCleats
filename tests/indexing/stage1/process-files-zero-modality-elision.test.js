#!/usr/bin/env node
import assert from 'node:assert/strict';
import { processFiles } from '../../../src/index/build/indexer/steps/process-files.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const timing = {};
const state = { chunks: [] };
const phases = [];
const result = await processFiles({
  mode: 'records',
  runtime: { root: process.cwd() },
  discovery: null,
  outDir: process.cwd(),
  entries: [],
  contextWin: 0,
  timing,
  crashLogger: {
    enabled: true,
    updatePhase: (phase) => phases.push(String(phase || '')),
    updateFile: () => {},
    logError: () => {}
  },
  state,
  perfProfile: null,
  cacheReporter: { report: () => {} },
  seenFiles: new Set(),
  incrementalState: null,
  relationsEnabled: false,
  shardPerfProfile: null,
  fileTextCache: null,
  abortSignal: null
});

assert.equal(result?.stageElided, true, 'expected stage-elided result for zero-modality input');
assert.equal(timing.processMs, 0, 'expected zero processing duration for elided stage');
assert.equal(
  state?.modalityStageElisions?.records?.chunkCount,
  0,
  'expected stage-elision metadata for records mode'
);
assert.equal(
  phases.includes('processing'),
  true,
  'expected crash logger phase update before stage elision return'
);

console.log('process-files zero-modality elision test passed');
