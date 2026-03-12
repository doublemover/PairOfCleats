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
  message: 'duplicated'
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

assert.equal(output.diagnostics.stream.fileCount, 1, 'expected master diagnostics stream to be ignored when repo streams exist');
assert.equal(output.diagnostics.stream.eventCount, 1, 'expected deduped diagnostics event count');
assert.equal(output.diagnostics.progressConfidence.fileCount, 1, 'expected master progress-confidence stream to be ignored');
assert.equal(output.diagnostics.preflight.fileCount, 1, 'expected master log to be ignored for preflight summary');
assert.equal(output.diagnostics.preflight.eventCount, 1, 'expected one preflight event after master-log dedupe');

console.log('bench language report master dedupe test passed');
