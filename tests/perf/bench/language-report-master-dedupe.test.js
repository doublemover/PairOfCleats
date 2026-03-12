#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-report-master-dedupe');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const runSuffix = '20260311-000000';
const event = JSON.stringify({
  eventType: 'parser_crash',
  eventId: 'dedupe-event',
  signature: 'dedupe-event',
  message: 'duplicated',
  label: 'repo-a'
});
await fsPromises.writeFile(path.join(logsRoot, `run-${runSuffix}-all.diagnostics.jsonl`), `${event}\n`, 'utf8');
await fsPromises.writeFile(path.join(logsRoot, `run-${runSuffix}-repo-a.diagnostics.jsonl`), `${event}\n`, 'utf8');
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-all.progress-confidence.jsonl`),
  `${JSON.stringify({ score: 0.5, bucket: 'medium', label: 'repo-a', ts: '2026-03-11T00:00:00.000Z' })}\n`,
  'utf8'
);
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-repo-a.progress-confidence.jsonl`),
  `${JSON.stringify({ score: 0.5, bucket: 'medium', label: 'repo-a', ts: '2026-03-11T00:00:00.000Z' })}\n`,
  'utf8'
);
const preflightLine = '[tooling] preflight:ok provider=gopls id=gopls.workspace-model durationMs=87 state=ready';
await fsPromises.writeFile(path.join(logsRoot, `run-${runSuffix}-all.log`), `${preflightLine}\n`, 'utf8');
await fsPromises.writeFile(path.join(logsRoot, `run-${runSuffix}-repo-a.log`), `${preflightLine}\n`, 'utf8');

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: tempRoot,
  results: [],
  config: {},
  runSuffix
});

assert.equal(output.diagnostics.stream.fileCount, 2, 'expected both master and repo diagnostics streams to be scanned');
assert.equal(output.diagnostics.stream.eventCount, 1, 'expected deduped diagnostics event count');
assert.equal(output.diagnostics.stream.rawEventCount, 2, 'expected raw diagnostics count across master and repo');
assert.equal(output.diagnostics.stream.duplicateEventCount, 1, 'expected one duplicate diagnostics event');
assert.equal(output.diagnostics.progressConfidence.fileCount, 2, 'expected both master and repo progress-confidence streams to be scanned');
assert.equal(output.diagnostics.progressConfidence.eventCount, 1, 'expected deduped progress-confidence event count');
assert.equal(output.diagnostics.preflight.fileCount, 2, 'expected both master and repo logs to be scanned for preflight summary');
assert.equal(output.diagnostics.preflight.eventCount, 1, 'expected one preflight event after master-log dedupe');
assert.equal(output.diagnostics.preflight.rawEventCount, 2, 'expected raw preflight count across master and repo');
assert.equal(output.diagnostics.preflight.duplicateEventCount, 1, 'expected one duplicate preflight event');

console.log('bench language report master dedupe test passed');
