#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  EMBEDDINGS_PERF_METRIC_KEYS,
  formatEmbeddingsPerfLine,
  parseEmbeddingsPerfLine
} from '../../../src/shared/embeddings-progress.js';

const metrics = {
  files_total: 12,
  files_done: 5,
  chunks_total: 120,
  chunks_done: 48,
  cache_attempts: 5,
  cache_hits: 3,
  cache_misses: 2,
  cache_rejected: 1,
  cache_fast_rejects: 1,
  cache_hit_files: 2,
  computed_files: 3,
  skipped_files: 0,
  texts_scheduled: 90,
  texts_resolved: 72,
  texts_embedded: 60,
  batches_completed: 8,
  tokens_processed: 2048,
  embed_compute_ms: 321,
  elapsed_ms: 1500,
  files_per_sec: 3.33333,
  chunks_per_sec: 32.125,
  embed_resolved_per_sec: 48.25,
  writer_pending: 1,
  writer_max_pending: 4,
  queue_compute_pending: 2,
  queue_io_pending: 1
};

const line = formatEmbeddingsPerfLine({
  mode: 'code',
  kind: 'perf_progress',
  metrics
});

assert.match(line, /^\[embeddings\] code: perf_progress /, 'expected perf_progress prefix');
for (const key of EMBEDDINGS_PERF_METRIC_KEYS) {
  assert.match(line, new RegExp(`${key}=`), `expected key ${key} to be present`);
}
assert.match(line, /files_per_sec=3.333/, 'expected rate metrics to use fixed precision');
assert.match(line, /chunks_per_sec=32.125/, 'expected rate metrics to preserve fixed precision');

const parsed = parseEmbeddingsPerfLine(line);
assert.ok(parsed, 'expected line to parse');
assert.equal(parsed.mode, 'code');
assert.equal(parsed.kind, 'perf_progress');
assert.equal(parsed.metrics.files_done, 5);
assert.equal(parsed.metrics.files_total, 12);
assert.equal(parsed.metrics.elapsed_ms, 1500);
assert.equal(parsed.metrics.files_per_sec, 3.333);
assert.equal(parsed.metrics.chunks_per_sec, 32.125);
assert.equal(parsed.metrics.embed_resolved_per_sec, 48.25);
assert.equal(parseEmbeddingsPerfLine('not-a-perf-line'), null, 'expected non-perf line to be ignored');

console.log('embeddings progress line contract test passed');
