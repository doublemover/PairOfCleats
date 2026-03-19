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
  "console.log('[tooling] preflight:start provider=gopls id=gopls.workspace-model class=workspace timeoutMs=20000');",
  "console.log('[tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked');",
  "console.log('[tooling] request:timeout provider=pyright method=textDocument/documentSymbol stage=documentSymbol workspacePartition=. class=timeout');",
  "console.log('[tooling] request:failed provider=sourcekit method=textDocument/semanticTokens/full stage=semantic_tokens workspacePartition=swift-package class=request_failed');",
  "console.log('[tooling] pyright circuit breaker tripped.');",
  "console.log('[tooling] pyright degraded mode active (fail-open).');",
  "console.log('[tooling] pyright degraded mode cleared.');",
  "console.log('[tooling] workspace:partition provider=gopls state=degraded reason=gopls_workspace_partition_incomplete workspacePartition=multiple partitionCount=2 unmatchedDocuments=1 unmatchedTargets=1');",
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
assert.equal(result.diagnostics.eventCount, 15, 'expected structured diagnostics to include tooling/runtime events');
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
assert.equal(streamLines.length, 15, 'expected full JSON event stream with all occurrences');

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
const requestTimeoutEvent = streamEvents.find((entry) => entry.eventType === 'provider_request_timeout');
assert.equal(requestTimeoutEvent?.providerId, 'pyright', 'expected provider correlation on request timeout');
assert.equal(requestTimeoutEvent?.requestMethod, 'textDocument/documentSymbol', 'expected request method on timeout event');
const preflightBlockedEvent = streamEvents.find((entry) => entry.eventType === 'provider_preflight_blocked');
assert.equal(preflightBlockedEvent?.providerId, 'gopls', 'expected provider correlation on preflight blocked event');
assert.equal(preflightBlockedEvent?.preflightState, 'blocked', 'expected blocked preflight state on stream event');
const workspacePartitionEvent = streamEvents.find((entry) => entry.eventType === 'workspace_partition_decision');
assert.equal(workspacePartitionEvent?.providerId, 'gopls', 'expected provider correlation on workspace routing event');
assert.equal(workspacePartitionEvent?.workspacePartition, 'multiple', 'expected workspace partition identifier on routing event');
for (const entry of streamEvents) {
  assert.match(entry.eventId, /^ub050:v1:[a-z_]+:[a-f0-9]{12}$/);
  assert.equal(entry.schemaVersion, BENCH_DIAGNOSTIC_STREAM_SCHEMA_VERSION, 'expected schema version on stream entry');
}

const interactiveDiagnostics = captured
  .filter((line) => line.startsWith('[diagnostics]'))
  .map((line) => line.replace(/ub050:v1:[a-z_]+:[a-f0-9]{12}/g, '<eventId>'))
  .sort();
const expectedInteractivePrefixes = [
  '[diagnostics] artifact_tail_stall <eventId> artifact tail stalled for 32000ms while writing shard',
  '[diagnostics] fallback_used <eventId> using fallback parser for unsupported grammar',
  '[diagnostics] parser_crash <eventId> tree-sitter parser crash while parsing src/main.c',
  '[diagnostics] provider_circuit_breaker <eventId> [tooling] pyright circuit breaker tripped.',
  '[diagnostics] provider_degraded_mode_cleared <eventId> [tooling] pyright degraded mode cleared.',
  '[diagnostics] provider_degraded_mode_entered <eventId> [tooling] pyright degraded mode active (fail-open).',
  '[diagnostics] provider_preflight_blocked <eventId> [tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked',
  '[diagnostics] provider_preflight_finish <eventId> [tooling] preflight:blocked provider=gopls id=gopls.workspace-model durationMs=87 state=blocked',
  '[diagnostics] provider_preflight_start <eventId> [tooling] preflight:start provider=gopls id=gopls.workspace-model class=workspace timeoutMs=20000',
  '[diagnostics] provider_request_failed <eventId> [tooling] request:failed provider=sourcekit method=textDocument/semanticTokens/full stage=semantic_tokens',
  '[diagnostics] provider_request_timeout <eventId> [tooling] request:timeout provider=pyright method=textDocument/documentSymbol stage=documentSymbol',
  '[diagnostics] queue_delay_hotspot <eventId> [tree-sitter:schedule] queue delay hotspot 1450ms',
  '[diagnostics] scm_timeout <eventId> [scm] timeout while collecting git metadata',
  '[diagnostics] workspace_partition_decision <eventId> [tooling] workspace:partition provider=gopls state=degraded reason=gopls_workspace_partition_incomplete'
];
assert.equal(interactiveDiagnostics.length, expectedInteractivePrefixes.length, 'expected one concise interactive line per unique diagnostic');
for (const prefix of expectedInteractivePrefixes) {
  assert.equal(
    interactiveDiagnostics.some((line) => line.startsWith(prefix)),
    true,
    `expected interactive diagnostics to include prefix: ${prefix}`
  );
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language process diagnostics stream test passed');
