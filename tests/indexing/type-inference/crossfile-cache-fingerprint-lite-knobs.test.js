#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildCrossFileFingerprint } from '../../../src/index/type-inference-crossfile/cache.js';

const chunks = [{
  file: 'src/app.js',
  name: 'run',
  kind: 'function',
  start: 0,
  end: 10,
  chunkUid: 'chunk-1',
  codeRelations: { calls: [['run', 'helper']], callDetails: [], usages: [] },
  docmeta: { returnType: 'void' }
}];

const base = {
  chunks,
  enableTypeInference: true,
  enableRiskCorrelation: true,
  useTooling: true,
  fileRelations: null
};

const fullFingerprint = buildCrossFileFingerprint({
  ...base,
  inferenceLite: false,
  inferenceLiteHighSignalOnly: true
});
const liteFingerprint = buildCrossFileFingerprint({
  ...base,
  inferenceLite: true,
  inferenceLiteHighSignalOnly: true
});
const liteBroadFingerprint = buildCrossFileFingerprint({
  ...base,
  inferenceLite: true,
  inferenceLiteHighSignalOnly: false
});

assert.notEqual(
  fullFingerprint,
  liteFingerprint,
  'expected inferenceLite mode to change cross-file cache fingerprint'
);
assert.notEqual(
  liteFingerprint,
  liteBroadFingerprint,
  'expected inferenceLiteHighSignalOnly to change cross-file cache fingerprint'
);

console.log('crossfile cache fingerprint lite knobs test passed');
