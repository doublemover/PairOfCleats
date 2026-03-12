#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-report-cross-repo-dedupe');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const runSuffix = '20260311-111111';
const diagnosticBase = {
  schemaVersion: 1,
  ts: new Date().toISOString(),
  eventType: 'parser_crash',
  eventId: 'same-event-id',
  signature: 'same-event-id',
  source: 'progress-event',
  message: 'same parser crash'
};
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-repo-a.diagnostics.jsonl`),
  `${JSON.stringify({ ...diagnosticBase, label: 'repo-a' })}\n`,
  'utf8'
);
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-repo-b.diagnostics.jsonl`),
  `${JSON.stringify({ ...diagnosticBase, label: 'repo-b' })}\n`,
  'utf8'
);

const progressEvent = {
  ts: '2026-03-11T00:00:00.000Z',
  score: 0.5,
  bucket: 'medium',
  reason: 'periodic'
};
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-repo-a.progress-confidence.jsonl`),
  `${JSON.stringify({ ...progressEvent, label: 'repo-a' })}\n`,
  'utf8'
);
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-repo-b.progress-confidence.jsonl`),
  `${JSON.stringify({ ...progressEvent, label: 'repo-b' })}\n`,
  'utf8'
);

const preflightLine = '[tooling] preflight:ok provider=gopls id=gopls.workspace-model durationMs=87 state=ready';
await fsPromises.writeFile(path.join(logsRoot, `run-${runSuffix}-repo-a.log`), `${preflightLine}\n`, 'utf8');
await fsPromises.writeFile(path.join(logsRoot, `run-${runSuffix}-repo-b.log`), `${preflightLine}\n`, 'utf8');

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: tempRoot,
  results: [],
  config: {},
  runSuffix
});

assert.equal(output.diagnostics.stream.eventCount, 2, 'expected diagnostics from two repo streams to remain distinct');
assert.equal(
  output.diagnostics.progressConfidence.eventCount,
  2,
  'expected progress-confidence events from two repo streams to remain distinct'
);
assert.equal(
  output.diagnostics.preflight.eventCount,
  2,
  'expected preflight events from two repo logs to remain distinct'
);

console.log('bench language report cross repo dedupe test passed');
