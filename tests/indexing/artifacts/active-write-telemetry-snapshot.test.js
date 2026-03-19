#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildActiveWriteTelemetrySnapshot,
  resolveActiveWritePhaseLabel
} from '../../../src/index/build/artifacts/write-telemetry.js';

const activeWrites = new Map([
  ['pieces/manifest.json', 1000],
  ['chunk_meta/shard-0001.jsonl', 4000],
  ['repo_map.json', 7000]
]);
const activeWriteBytes = new Map([
  ['pieces/manifest.json', 1024],
  ['chunk_meta/shard-0001.jsonl', 2048],
  ['repo_map.json', 4096]
]);
const activeWriteMeta = new Map([
  ['pieces/manifest.json', { phase: 'scheduler-wait', lane: 'light' }],
  ['chunk_meta/shard-0001.jsonl', { phase: 'job', lane: 'heavy' }],
  ['repo_map.json', { phase: 'prefetch-wait', lane: 'massive' }]
]);

const snapshot = buildActiveWriteTelemetrySnapshot({
  activeWrites,
  activeWriteBytes,
  activeWriteMeta,
  limit: 2,
  now: 8000,
  formatBytes: (bytes) => `${bytes}b`
});

assert.equal(snapshot.inflight.length, 3, 'expected all active writes in telemetry snapshot');
assert.equal(snapshot.inflight[0].label, 'pieces/manifest.json', 'expected longest-running write first');
assert.equal(snapshot.inflight[0].phase, 'scheduler-wait', 'expected phase metadata to carry through');
assert.equal(snapshot.inflight[0].phaseClass, 'other', 'expected phase class metadata to be captured');
assert.equal(
  snapshot.previewText,
  'pieces/manifest.json [scheduler-wait:light] (7s, ~1024b), chunk_meta/shard-0001.jsonl [job:heavy] (4s, ~2048b)',
  'expected preview text to include phase, lane, elapsed time, and bytes'
);
assert.equal(
  snapshot.phaseSummaryText,
  'job=1, prefetch-wait=1, scheduler-wait=1',
  'expected stable phase histogram summary'
);
assert.equal(snapshot.stallOwner, null, 'expected non-executing phases to avoid synthetic stall ownership');

const closeoutSnapshot = buildActiveWriteTelemetrySnapshot({
  activeWrites: new Map([
    ['closeout/pieces-manifest', 1000],
    ['chunk_meta.binary-columnar.bundle', 4000]
  ]),
  activeWriteBytes: new Map([
    ['closeout/pieces-manifest', 0],
    ['chunk_meta.binary-columnar.bundle', 1024]
  ]),
  activeWriteMeta: new Map([
    ['closeout/pieces-manifest', { phase: 'closeout:pieces-manifest', lane: 'closeout' }],
    ['chunk_meta.binary-columnar.bundle', { phase: 'materialize:chunk-meta-binary-columnar', lane: 'massive' }]
  ]),
  now: 8000
});
assert.equal(
  closeoutSnapshot.stallOwner,
  'closeout:pieces-manifest',
  'expected closeout work to surface as the active stall owner before generic non-write attribution'
);
assert.equal(
  resolveActiveWritePhaseLabel('closeout/pieces-manifest'),
  'closeout:pieces-manifest',
  'expected closeout labels to classify into explicit closeout phases'
);
assert.equal(
  resolveActiveWritePhaseLabel('token_postings.shards/part-0001.bin'),
  'write:binary',
  'expected shard binary labels to classify into binary write phases'
);

console.log('artifact active write telemetry snapshot test passed');
