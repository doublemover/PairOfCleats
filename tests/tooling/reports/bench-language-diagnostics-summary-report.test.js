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
const logA = path.join(logsRoot, 'run-ub050-all.log');
const logB = path.join(logsRoot, 'run-ub050-owner-repo.log');
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
    }),
    JSON.stringify({
      schemaVersion: 1,
      ts: now,
      eventType: 'warning_suppressed',
      eventId: 'ub050:v1:warning_suppressed:ffffffffffff',
      occurrence: 1,
      signature: 'warning-suppressed',
      source: 'stdout',
      severity: 'warn',
      providerId: 'clangd',
      failureClass: 'stderr:includecleaner',
      message: '[tooling] clangd suppressed 2 IncludeCleaner stderr line(s); missing include roots should be configured via compile_commands.json.'
    })
  ].join('\n') + '\n',
  'utf8'
);

await fsPromises.writeFile(
  logA,
  [
    '[diagnostics] parser_crash ub050:v1:parser_crash:aaaaaaaaaaaa tree-sitter parser crash'
  ].join('\n') + '\n',
  'utf8'
);

await fsPromises.writeFile(
  logB,
  [
    'using fallback parser',
    '[tooling] clangd suppressed 2 IncludeCleaner stderr line(s); missing include roots should be configured via compile_commands.json.'
  ].join('\n') + '\n',
  'utf8'
);

const output = await buildReportOutput({
  configPath: '/tmp/repos.json',
  cacheRoot: '/tmp/cache',
  resultsRoot: tempRoot,
  results: [],
  config: {}
});

const stream = output?.diagnostics?.stream;
assert.ok(stream && typeof stream === 'object', 'expected diagnostics stream summary');
assert.equal(stream.schemaVersion, BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION, 'expected diagnostics stream schema');
assert.equal(stream.fileCount, 2, 'expected both diagnostics streams to be scanned');
assert.equal(stream.eventCount, 6, 'expected deduped event count across master and repo streams');
assert.equal(stream.rawEventCount, 7, 'expected raw event count to include duplicate fallback event');
assert.equal(stream.duplicateEventCount, 1, 'expected one duplicate event across the merged streams');
assert.equal(stream.uniqueEventCount, 6, 'expected unique event count across both streams');
assert.equal(stream.malformedLines, 1, 'expected malformed master stream line to be tracked');
assert.equal(stream.countScopes?.countsByType, 'event_presence', 'expected explicit event scope labeling');
assert.equal(stream.countScopes?.repoCountsByType, 'repo_presence', 'expected explicit repo scope labeling');

assert.equal(stream.countsByType.parser_crash || 0, 1, 'expected master-only parser_crash to be preserved');
assert.equal(stream.countsByType.scm_timeout, 1, 'expected scm_timeout count');
assert.equal(stream.countsByType.queue_delay_hotspot, 1, 'expected queue_delay_hotspot count');
assert.equal(stream.countsByType.artifact_tail_stall, 1, 'expected artifact_tail_stall count');
assert.equal(stream.countsByType.warning_suppressed, 1, 'expected warning_suppressed count');
assert.equal(stream.countsByType.fallback_used || 0, 1, 'expected fallback duplicates to be deduped, not dropped');
assert.equal(stream.repoCountsByType.parser_crash || 0, 1, 'expected parser crash repo count');
assert.equal(stream.repoCountsByType.fallback_used || 0, 1, 'expected fallback repo count');
assert.equal(stream.repoCountsByType.warning_suppressed || 0, 1, 'expected warning suppression repo count');
assert.equal(stream.unknownTypeCount, 0, 'expected no unknown event types');
assert.deepEqual(
  stream.countsBySeverity,
  { error: 1, info: 0, warn: 5 },
  'expected consequence-based severity counts across merged diagnostics streams'
);

assert.equal(stream.required.parser_crash, 1, 'expected parser_crash from master stream to be counted');
assert.equal(stream.required.scm_timeout, 1, 'expected required scm_timeout coverage');
assert.equal(stream.required.queue_delay_hotspot, 1, 'expected required queue_delay_hotspot coverage');
assert.equal(stream.required.artifact_tail_stall, 1, 'expected required artifact_tail_stall coverage');
assert.equal(stream.required.warning_suppressed, 1, 'expected warning_suppressed coverage');
assert.equal(stream.required.fallback_used, 1, 'expected duplicated fallback events to be deduped');

const parity = output?.diagnostics?.parity;
assert.ok(parity && typeof parity === 'object', 'expected diagnostics parity summary');
assert.equal(parity.status, 'ok', 'expected diagnostics parity to agree with aggregate logs');
assert.equal(parity.materialMismatchCount, 0, 'expected no material diagnostics parity mismatches');
assert.equal(parity.countScopes?.countsFromLogs, 'event_presence', 'expected parity event scope label');
assert.equal(parity.countScopes?.repoCountsFromLogs, 'repo_presence', 'expected parity repo scope label');
assert.equal(parity.countsFromLogs.fallback_used, 1, 'expected fallback parity count from aggregate logs');
assert.equal(parity.countsFromDiagnosticsStream.fallback_used, 1, 'expected fallback parity count from stream');
assert.equal(parity.countsFromLogs.warning_suppressed, 1, 'expected warning suppression parity count from aggregate logs');
assert.equal(parity.countsFromDiagnosticsStream.warning_suppressed, 1, 'expected warning suppression parity count from stream');
assert.equal(parity.repoCountsFromLogs.fallback_used, 1, 'expected repo-scoped fallback parity count from aggregate logs');
assert.equal(parity.repoCountsFromDiagnosticsStream.fallback_used, 1, 'expected repo-scoped fallback parity count from stream');

assert.equal(
  stream.files.some((entry) => entry.path === streamB && entry.eventCount === 4),
  true,
  'expected canonical repo stream summary'
);
assert.equal(
  stream.files.some((entry) => entry.path === streamA && entry.eventCount === 3),
  true,
  'expected master diagnostics stream summary'
);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language diagnostics summary report test passed');
