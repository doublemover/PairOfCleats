#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createProcessRunner } from '../../../tools/bench/language/process.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
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
  typeof result.progressConfidence.score === 'number' && Number.isFinite(result.progressConfidence.score),
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
assert.equal(typeof last.score, 'number');
assert.equal(Number.isFinite(last.score), true);
assert.equal(last.coverage.state, 'observed');
assert.equal(last.observation.state, 'observed');
assert.equal(last.observation.view, 'last-observed-snapshot');

const replayConfidence = async (name, sourcePath) => {
  const resultsRoot = path.join(tempRoot, `replay-${name}`);
  const logs = path.join(resultsRoot, 'logs', 'bench-language');
  await fsPromises.mkdir(logs, { recursive: true });
  // Copy the producer's bytes without reconstructing its confidence fields.
  for (const scope of ['all', 'repo-a']) await fsPromises.copyFile(sourcePath,
    path.join(logs, `run-confidence-${scope}.progress-confidence.jsonl`));
  const report = await buildReportOutput({ configPath: path.join(resultsRoot, 'repos.json'), cacheRoot: resultsRoot,
    resultsRoot, results: [], config: {}, runSuffix: 'confidence' });
  assert.equal(report.diagnostics.streamRead.metrics.fileOpens, 2);
  return report.diagnostics.progressConfidence;
};
const positiveReplay = await replayConfidence('observed', confidencePath);
const observedScores = lines.map(JSON.parse).filter(row => typeof row.score === 'number' && Number.isFinite(row.score)).map(row => row.score);
assert.ok(observedScores.length > 0);
assert.equal(positiveReplay.scoreCoverage.observed, observedScores.length);
assert.ok(Math.abs(positiveReplay.avgScore - observedScores.reduce((a, b) => a + b, 0) / observedScores.length) < 1e-12);
assert.equal(positiveReplay.rawEventCount, lines.length * 2);
assert.equal(positiveReplay.duplicateEventCount, lines.length);

for (const [name, source] of [
  ['silent', ''], ['ordinary', "console.log('ordinary output');"],
  ['null-fields', "for (let i = 0; i < 2; i++) console.log(JSON.stringify({ proto: 'poc.progress@2', event: 'log', ts: new Date().toISOString(), message: 'ordinary output', queueAgeMs: null, inFlight: null }));"],
  ['start-only', "console.log(JSON.stringify({ proto: 'poc.progress@2', event: 'task:start', ts: new Date().toISOString(), taskId: 'one', stage: 'parse', current: 0, total: 1, inFlight: 1, meta: { queueAgeMs: 10 } }));"]
]) {
  const caseLog = path.join(tempRoot, `run-${name}-all.log`), messages = [];
  const childRunner = createProcessRunner({ appendLog: message => messages.push(message), writeLog: () => {},
    writeLogSync: () => {}, logHistory: [], logPath: caseLog, getLogPaths: () => [caseLog], onProgressEvent: () => {} });
  const child = await childRunner.runProcess(name, process.execPath, ['-e', source], { continueOnError: true, timeoutMs: 3000 });
  assert.equal(child.ok, true);
  assert.equal(child.progressConfidence.heartbeat.count, name === 'start-only' ? 1 : 0, 'control must exercise the declared protocol route');
  assert.equal(child.progressConfidence.queueAge.count, name === 'start-only' ? 1 : 0);
  assert.equal(child.progressConfidence.inFlight.count, name === 'start-only' ? 1 : 0);
  assert.equal(child.progressConfidence.score, null, name);
  assert.equal(child.progressConfidence.bucket, 'unknown', name);
  assert.equal(child.progressConfidence.coverage.state, 'insufficient', name);
  assert.deepEqual(child.progressConfidence.coverage.eligibleComponents, [], name);
  assert.equal(messages.some(message => /confidence high 100/u.test(message)), false);
  const rows = (await fsPromises.readFile(caseLog.replace(/\.log$/u, '.progress-confidence.jsonl'), 'utf8')).trim().split(/\r?\n/u).map(JSON.parse);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every(row => row.score === null && row.bucket === 'unknown'), name);
  const replay = await replayConfidence(name, caseLog.replace(/\.log$/u, '.progress-confidence.jsonl'));
  assert.equal(replay.avgScore, null, name);
  assert.equal(replay.minScore, null, name);
  assert.equal(replay.scoreCoverage.observed, 0, name);
  assert.equal(replay.scoreCoverage.unknown, rows.length, name);
  assert.equal(replay.rawEventCount, rows.length * 2, name);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });

console.log('bench language process progress confidence test passed');
