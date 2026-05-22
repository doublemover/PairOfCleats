#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  createProcessChunksFixtureContext,
  processFixtureChunks
} from '../file-processor/process-chunks-fixture.js';

const { context: baseContext } = createProcessChunksFixtureContext();

const disabled = await processFixtureChunks(baseContext, {
  analysisPolicy: {
    metadata: { enabled: false },
    risk: { enabled: false },
    typeInference: { local: { enabled: false } }
  }
});

assert.ok(disabled.chunks.length === 1, 'expected chunk output');
assert.equal(disabled.chunks[0].metaV2, null, 'metadata should be disabled');
assert.ok(!disabled.chunks[0].docmeta?.risk, 'risk metadata should be disabled');
assert.ok(!disabled.chunks[0].docmeta?.inferredTypes, 'type inference should be disabled');

const enabled = await processFixtureChunks(baseContext, {
  analysisPolicy: {
    metadata: { enabled: true },
    risk: { enabled: true },
    typeInference: { local: { enabled: true } }
  }
});

assert.ok(enabled.chunks[0].metaV2, 'metadata should be present');
assert.ok(enabled.chunks[0].docmeta?.risk, 'risk metadata should be present');
assert.ok(enabled.chunks[0].docmeta?.inferredTypes, 'type inference should be present');

console.log('analysis policy gating test passed');
