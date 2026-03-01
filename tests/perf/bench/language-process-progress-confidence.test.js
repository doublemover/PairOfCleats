#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';
import { BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION } from '../../../tools/bench/language/logging.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-process-progress-confidence');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const masterLogPath = path.join(tempRoot, 'run-all.log');
const logHistory = [];
const runner = createProcessRunner({
  appendLog: () => {},
  writeLog: () => {},
  writeLogSync: () => {},
  logHistory,
  logPath: masterLogPath,
  getLogPaths: () => [masterLogPath],
  onProgressEvent: () => {}
});

const script = [
  "const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
  "const emit = (event, payload) => console.log(JSON.stringify({ proto: 'poc.progress@2', event, ts: new Date().toISOString(), ...payload }));",
  '(async () => {',
  "  emit('task:start', { taskId: 'overall', stage: 'overall', current: 0, total: 4, message: 'starting', inFlight: 1, meta: { queueAgeMs: 25 } });",
  '  await wait(40);',
  "  emit('task:progress', { taskId: 'overall', stage: 'overall', current: 1, total: 4, message: '[tree-sitter:schedule] queue delay 120ms', inFlight: 2, meta: { queueAgeMs: 120 } });",
  '  await wait(55);',
  "  emit('log', { level: 'warn', stage: 'watchdog', taskId: 'stage:watchdog', message: '[tree-sitter:schedule] queue delay hotspot 980ms' });",
  '  await wait(60);',
  "  emit('task:progress', { taskId: 'overall', stage: 'overall', current: 2, total: 4, message: 'processing', inFlight: 4, meta: { queueAgeMs: 220 } });",
  '  await wait(45);',
  "  emit('task:end', { taskId: 'overall', stage: 'overall', current: 4, total: 4, status: 'done', message: 'complete', inFlight: 1, meta: { queueAgeMs: 40 } });",
  '})();',
  'setTimeout(() => process.exit(0), 250);'
].join('');

const result = await runner.runProcess(
  'ub098-progress-confidence',
  process.execPath,
  ['-e', script],
  { continueOnError: true }
);

assert.equal(result.ok, true, 'expected subprocess success');
assert.ok(result.progressConfidence && typeof result.progressConfidence === 'object', 'expected progress confidence summary');
assert.equal(
  result.progressConfidence.schemaVersion,
  BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION,
  'expected confidence schema version'
);
assert.equal(
  Number.isFinite(Number(result.progressConfidence.score)),
  true,
  'expected numeric confidence score'
);
assert.equal(result.progressConfidence.stallEvents >= 1, true, 'expected stall signal from queue hotspot');
assert.equal(result.progressConfidence.confidenceEvents >= 1, true, 'expected confidence event stream emissions');

const confidencePath = path.join(tempRoot, 'run-all.progress-confidence.jsonl');
assert.equal(fs.existsSync(confidencePath), true, 'expected progress confidence stream file to exist');
assert.equal(
  result.progressConfidence.streamPaths.includes(confidencePath),
  true,
  'expected confidence stream path to be included in process summary'
);

const lines = (await fsPromises.readFile(confidencePath, 'utf8'))
  .split(/\r?\n/)
  .filter((line) => line.trim());
assert.equal(lines.length >= 1, true, 'expected at least one persisted confidence event');
const last = JSON.parse(lines[lines.length - 1]);
assert.equal(last.schemaVersion, BENCH_PROGRESS_CONFIDENCE_SCHEMA_VERSION, 'expected schema version in persisted stream');
assert.equal(typeof last.bucket, 'string', 'expected persisted confidence bucket');

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language process progress confidence test passed');
