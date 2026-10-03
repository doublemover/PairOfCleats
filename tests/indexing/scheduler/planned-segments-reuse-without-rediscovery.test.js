#!/usr/bin/env node
import assert from 'node:assert/strict';

import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { assignSegmentUids, discoverSegments, normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { createTreeSitterProcessFileCpuFixture } from '../file-processor/tree-sitter-process-file-cpu-fixture.js';

const {
  ext,
  relKey,
  text,
  languageHint,
  createContext
} = await createTreeSitterProcessFileCpuFixture({
  fileHash: 'scheduler-planned-segments-test'
});

const chunkFingerprint = (chunk) => ({
  chunkUid: chunk.chunkUid,
  chunkId: chunk.metaV2?.chunkId || null,
  virtualPath: chunk.virtualPath,
  lang: chunk.lang,
  kind: chunk.kind,
  name: chunk.name,
  start: chunk.start,
  end: chunk.end,
  startLine: chunk.startLine,
  endLine: chunk.endLine,
  signature: chunk.docmeta?.signature || null
});

const baselineResult = await processFileCpu(createContext({
  languageOptions: { treeSitter: { enabled: false } },
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
  treeSitterScheduler: null
}));
assert.ok(Array.isArray(baselineResult.chunks) && baselineResult.chunks.length > 0, 'expected baseline chunks');

const plannedSegments = discoverSegments({
  text,
  ext,
  relPath: relKey,
  mode: 'code',
  languageId: languageHint?.id || null,
  context: null,
  segmentsConfig: normalizeSegmentsConfig(null),
  extraSegments: []
});
await assignSegmentUids({ text, segments: plannedSegments, ext, mode: 'code' });

const throwingSegmentsConfig = {};
Object.defineProperty(throwingSegmentsConfig, 'cdc', {
  enumerable: true,
  configurable: true,
  get() {
    throw new Error('discover-segments-should-not-run');
  }
});

let loadPlannedSegmentsCalls = 0;
let loadChunksCalls = 0;
const scheduler = {
  index: new Map(),
  loadPlannedSegments(containerPath) {
    loadPlannedSegmentsCalls += 1;
    assert.equal(containerPath, relKey, 'expected per-file planned segment lookup');
    return plannedSegments.map((segment) => ({ ...segment }));
  },
  async loadChunks() {
    loadChunksCalls += 1;
    return null;
  }
};

const plannedResult = await processFileCpu(createContext({
  languageOptions: { treeSitter: { enabled: true, strict: false } },
  normalizedSegmentsConfig: throwingSegmentsConfig,
  treeSitterScheduler: scheduler
}));
assert.equal(plannedResult.skip, null, 'expected planned-segment path to complete without skip');
assert.ok(loadPlannedSegmentsCalls > 0, 'expected scheduler planned segment lookup');
assert.ok(loadChunksCalls > 0, 'expected scheduler chunk lookup attempts');
assert.deepEqual(
  plannedResult.chunks.map(chunkFingerprint),
  baselineResult.chunks.map(chunkFingerprint),
  'expected planned-segment reuse path to preserve chunk boundaries/IDs/metadata'
);

console.log('scheduler planned-segment reuse without rediscovery test passed');
