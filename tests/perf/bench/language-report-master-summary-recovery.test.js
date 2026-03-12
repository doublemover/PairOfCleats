#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureTestingEnv } from '../../helpers/test-env.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

ensureTestingEnv(process.env);

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-report-master-summary-recovery');
const logsRoot = path.join(tempRoot, 'logs', 'bench-language');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(logsRoot, { recursive: true });

const runSuffix = '20260312-000000';
const sharedSummary = '[tooling] preflight summary total=1 cached=0 timedOut=0 failed=0 queuePeak=1 teardownTimedOut=0 states=ready:1 classes=workspace:1 policies=block:1';
const masterUniqueSummary = '[tooling] preflight summary total=2 cached=1 timedOut=0 failed=0 queuePeak=2 teardownTimedOut=0 states=ready:2 classes=workspace:2 policies=block:2';
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-all.log`),
  `${sharedSummary}\n${masterUniqueSummary}\n`,
  'utf8'
);
await fsPromises.writeFile(
  path.join(logsRoot, `run-${runSuffix}-repo-a.log`),
  `${sharedSummary}\n`,
  'utf8'
);

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot: tempRoot,
  results: [],
  config: {},
  runSuffix
});

assert.equal(
  output.diagnostics.preflight.summary.lineCount,
  2,
  'expected unique master-only summaries to remain visible when repo logs are incomplete'
);

console.log('bench language report master summary recovery test passed');
