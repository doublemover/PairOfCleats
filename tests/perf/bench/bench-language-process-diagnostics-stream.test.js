#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';
import {
  BENCH_DIAGNOSTIC_EVENT_TYPES,
  BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION
} from '../../../tools/bench/language/logging.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-process-diagnostics-stream');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const masterLogPath = path.join(tempRoot, 'run-all.log');
const captured = [];
const logHistory = [];
const runner = createProcessRunner({
  appendLog: (line) => {
    if (line) captured.push(String(line));
  },
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory,
  logPath: masterLogPath,
  getLogPaths: () => [masterLogPath],
  onProgressEvent: () => {}
});

const script = [
  "const progress = (payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event: 'log', ts: new Date().toISOString(), ...payload }));",
  "progress({ level: 'error', stage: 'parse', taskId: 'stage:parse', message: 'tree-sitter parser crash while parsing src/main.c' });",
  "console.error('[scm] timeout while collecting git metadata');",
  "progress({ level: 'warn', stage: 'watchdog', taskId: 'stage:watchdog', message: '[tree-sitter:schedule] queue delay hotspot 1450ms' });",
  "console.log('artifact tail stalled for 32000ms while writing shard');",
  "const fallback = JSON.stringify({ proto: 'poc.progress@2', event: 'log', ts: new Date().toISOString(), level: 'warn', stage: 'parse', taskId: 'stage:parse', message: 'using fallback parser for unsupported grammar' });",
  'console.log(fallback);',
  'console.log(fallback);',
  'process.exit(0);'
].join('');

const result = await runner.runProcess(
  'ub050-diagnostics',
  process.execPath,
  ['-e', script],
  { continueOnError: true }
);

assert.equal(result.ok, true, 'expected subprocess success');
assert.ok(result.diagnostics && typeof result.diagnostics === 'object', 'expected diagnostics summary on result');
assert.equal(
  result.diagnostics.schemaVersion,
  BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION,
  'expected diagnostics schema version'
);
assert.equal(result.diagnostics.eventCount, 6, 'expected six diagnostic events including fallback duplicate');
assert.equal(result.diagnostics.countsByType.fallback_used, 2, 'expected fallback duplicate count in full stream');

for (const type of BENCH_DIAGNOSTIC_EVENT_TYPES) {
  assert.equal(
    Number(result.diagnostics.countsByType[type] || 0) > 0,
    true,
    `expected required diagnostic type ${type}`
  );
}

const diagnosticsPath = path.join(tempRoot, 'run-all.diagnostics.jsonl');
assert.equal(fs.existsSync(diagnosticsPath), true, 'expected diagnostics stream file to exist');
assert.equal(
  result.diagnostics.streamPaths.includes(diagnosticsPath),
  true,
  'expected diagnostics path in process result summary'
);

const streamLines = (await fsPromises.readFile(diagnosticsPath, 'utf8'))
  .split(/\r?\n/)
  .filter((line) => line.trim());
assert.equal(streamLines.length, 6, 'expected full JSON event stream with all occurrences');

const streamEvents = streamLines.map((line) => JSON.parse(line));
const fallbackEvents = streamEvents.filter((entry) => entry.eventType === 'fallback_used');
assert.equal(fallbackEvents.length, 2, 'expected two fallback events in persisted stream');
assert.equal(
  new Set(fallbackEvents.map((entry) => entry.eventId)).size,
  1,
  'expected stable fallback event ID for dedupe/rate-limiting'
);
assert.deepEqual(
  fallbackEvents.map((entry) => entry.occurrence),
  [1, 2],
  'expected fallback occurrence counter to increment'
);
for (const entry of streamEvents) {
  assert.match(entry.eventId, /^ub050:v1:[a-z_]+:[a-f0-9]{12}$/);
  assert.equal(entry.schemaVersion, BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION, 'expected schema version on stream entry');
}

const interactiveDiagnostics = captured
  .filter((line) => line.startsWith('[diagnostics]'))
  .map((line) => line.replace(/ub050:v1:[a-z_]+:[a-f0-9]{12}/g, '<eventId>'))
  .sort();
assert.deepEqual(
  interactiveDiagnostics,
  [
    '[diagnostics] artifact_tail_stall <eventId> artifact tail stalled for 32000ms while writing shard',
    '[diagnostics] fallback_used <eventId> using fallback parser for unsupported grammar',
    '[diagnostics] parser_crash <eventId> tree-sitter parser crash while parsing src/main.c',
    '[diagnostics] queue_delay_hotspot <eventId> [tree-sitter:schedule] queue delay hotspot 1450ms',
    '[diagnostics] scm_timeout <eventId> [scm] timeout while collecting git metadata'
  ],
  'expected concise interactive diagnostics snapshot (deduped)'
);

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language process diagnostics stream test passed');
