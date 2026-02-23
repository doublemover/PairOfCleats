#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION } from '../../../tools/bench/language/logging.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-diagnostics-summary-report');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const streamA = path.join(logsRoot, 'run-ub050-all.diagnostics.jsonl');
const streamB = path.join(logsRoot, 'run-ub050-owner-repo.diagnostics.jsonl');
const now = new Date().toISOString();

await fsPromises.writeFile(
  streamA,
  [
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'parser_crash',
      eventId: 'ub050:v1:parser_crash:aaaaaaaaaaaa',
      occurrence: 1,
      signature: 'parser',
      source: 'progress-event',
      message: 'tree-sitter parser crash'
    }),
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'fallback_used',
      eventId: 'ub050:v1:fallback_used:bbbbbbbbbbbb',
      occurrence: 1,
      signature: 'fallback',
      source: 'progress-event',
      message: 'using fallback parser'
    }),
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'fallback_used',
      eventId: 'ub050:v1:fallback_used:bbbbbbbbbbbb',
      occurrence: 2,
      signature: 'fallback',
      source: 'progress-event',
      message: 'using fallback parser'
    }),
    '{malformed'
  ].join('\n') + '\n',
  'utf8'
);

await fsPromises.writeFile(
  streamB,
  [
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'scm_timeout',
      eventId: 'ub050:v1:scm_timeout:cccccccccccc',
      occurrence: 1,
      signature: 'scm-timeout',
      source: 'stderr',
      message: 'scm timeout while reading git metadata'
    }),
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'queue_delay_hotspot',
      eventId: 'ub050:v1:queue_delay_hotspot:dddddddddddd',
      occurrence: 1,
      signature: 'queue-delay',
      source: 'progress-event',
      message: '[tree-sitter:schedule] queue delay hotspot 1450ms'
    }),
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'artifact_tail_stall',
      eventId: 'ub050:v1:artifact_tail_stall:eeeeeeeeeeee',
      occurrence: 1,
      signature: 'artifact-tail-stall',
      source: 'stdout',
      message: 'artifact tail stalled while writing shard'
    })
  ].join('\n') + '\n',
  'utf8'
);

const output = buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: tempRoot,
  results: [],
  config: {}
});

const stream = output?.diagnostics?.stream;
assert.ok(stream && typeof stream === 'object', 'expected diagnostics stream summary');
assert.equal(stream.schemaVersion, BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION, 'expected diagnostics stream schema');
assert.equal(stream.fileCount, 2, 'expected two diagnostics stream files');
assert.equal(stream.eventCount, 6, 'expected all valid stream events to be counted');
assert.equal(stream.uniqueEventCount, 5, 'expected dedupe across stable event IDs');
assert.equal(stream.malformedLines, 1, 'expected malformed line accounting');

assert.equal(stream.countsByType.parser_crash, 1, 'expected parser_crash count');
assert.equal(stream.countsByType.scm_timeout, 1, 'expected scm_timeout count');
assert.equal(stream.countsByType.queue_delay_hotspot, 1, 'expected queue_delay_hotspot count');
assert.equal(stream.countsByType.artifact_tail_stall, 1, 'expected artifact_tail_stall count');
assert.equal(stream.countsByType.fallback_used, 2, 'expected fallback_used duplicate count');
assert.equal(stream.unknownTypeCount, 0, 'expected no unknown event types');

assert.equal(stream.required.parser_crash, 1, 'expected required parser_crash coverage');
assert.equal(stream.required.scm_timeout, 1, 'expected required scm_timeout coverage');
assert.equal(stream.required.queue_delay_hotspot, 1, 'expected required queue_delay_hotspot coverage');
assert.equal(stream.required.artifact_tail_stall, 1, 'expected required artifact_tail_stall coverage');
assert.equal(stream.required.fallback_used, 2, 'expected required fallback_used coverage');

assert.equal(
  stream.files.some((entry) => entry.path === streamA && entry.eventCount === 3),
  true,
  'expected streamA file summary'
);
assert.equal(
  stream.files.some((entry) => entry.path === streamB && entry.eventCount === 3),
  true,
  'expected streamB file summary'
);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language diagnostics summary report test passed');
