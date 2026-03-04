#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-report-run-scope');
const resultsRoot = path.join(tempRoot, 'results');
const logsRoot = path.join(resultsRoot, 'logs', 'bench-language');
const oldRunSuffix = '20260301-010101';
const activeRunSuffix = '20260304-112231';

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const write = (name, content) => fsPromises.writeFile(path.join(logsRoot, name), content, 'utf8');

await write(
  `run-${oldRunSuffix}-legacy.diagnostics.jsonl`,
  `${JSON.stringify({ eventType: 'parser_crash', eventId: 'old', signature: 'old', message: 'old event' })}\n`
);
await write(
  `run-${activeRunSuffix}-active.diagnostics.jsonl`,
  `${JSON.stringify({ eventType: 'scm_timeout', eventId: 'new', signature: 'new', message: 'new event' })}\n`
);
await write(
  `run-${oldRunSuffix}-legacy.progress-confidence.jsonl`,
  `${JSON.stringify({ score: 0.2, bucket: 'low', label: 'legacy', reason: 'old', ts: '2026-03-01T00:00:00.000Z' })}\n`
);
await write(
  `run-${activeRunSuffix}-active.progress-confidence.jsonl`,
  `${JSON.stringify({ score: 0.9, bucket: 'high', label: 'active', reason: 'new', ts: '2026-03-04T00:00:00.000Z' })}\n`
);
await write(
  `run-${oldRunSuffix}-legacy.log`,
  '[tooling] preflight:start provider=clangd id=clangd.workspace-model class=workspace timeoutMs=20000\n'
);
await write(
  `run-${activeRunSuffix}-active.log`,
  '[tooling] preflight:ok provider=clangd id=clangd.workspace-model class=workspace durationMs=87 state=ready\n'
);

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot,
  results: [],
  config: {},
  runSuffix: activeRunSuffix
});

assert.equal(output.diagnostics.stream.fileCount, 1, 'expected diagnostics summary to include only active-run stream files');
assert.equal(output.diagnostics.stream.eventCount, 1, 'expected only active-run diagnostic events');
assert.equal(output.diagnostics.stream.required.scm_timeout, 1, 'expected active-run diagnostic event type count');
assert.equal(output.diagnostics.stream.required.parser_crash, 0, 'expected legacy-run diagnostic event to be excluded');

assert.equal(output.diagnostics.progressConfidence.fileCount, 1, 'expected progress-confidence summary to include only active run');
assert.equal(output.diagnostics.progressConfidence.eventCount, 1, 'expected only active-run confidence events');
assert.equal(output.diagnostics.progressConfidence.latestByLabel.length, 1, 'expected only active run labels');
assert.equal(output.diagnostics.progressConfidence.latestByLabel[0]?.label, 'active', 'expected active run label');

assert.equal(output.diagnostics.preflight.fileCount, 1, 'expected preflight summary to include only active-run logs');
assert.equal(output.diagnostics.preflight.eventCount, 1, 'expected only active-run preflight events');
assert.equal(output.diagnostics.preflight.countsByEvent.ok, 1, 'expected active preflight ok event to be counted');
assert.equal(output.diagnostics.preflight.countsByEvent.start || 0, 0, 'expected legacy preflight start event to be excluded');

console.log('bench language report run-scope test passed');
