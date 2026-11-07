#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createBenchRunLedger } from '../../../tools/bench/language-repos/run-ledger.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

import { buildBenchEnvironmentMetadata } from '../../../tools/bench/language/logging.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-language-report-environment');
const resultsRoot = path.join(tempRoot, 'results');
const environmentMetadata = buildBenchEnvironmentMetadata({
  PAIROFCLEATS_TESTING: '1',
  ORG_GRADLE_DAEMON: 'false',
  GRADLE_OPTS: '-Dorg.gradle.daemon=false'
});

assert.ok(environmentMetadata.fingerprint, 'expected environment metadata fingerprint');
assert.equal(environmentMetadata.selected.PAIROFCLEATS_TESTING, '1');
assert.equal(environmentMetadata.selected.ORG_GRADLE_DAEMON, 'false');

const secret = 'synthetic-api-secret-never-persist-1679';
const raw = { PAIROFCLEATS_API_TOKEN: secret, PAIROFCLEATS_FUTURE_SECRET: secret,
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ api: { token: secret }, threads: 2 }),
  NODE_OPTIONS: `--require=https://user:${secret}@example.invalid/`,
  GRADLE_OPTS: `-Dorg.gradle.daemon=false -Dpassword=${secret}`,
  PAIROFCLEATS_THREADS: '2', PAIROFCLEATS_TESTING: '1' };
const safe = buildBenchEnvironmentMetadata(raw);
assert.equal(JSON.stringify(safe).includes(secret), false);
assert.deepEqual(safe.selected, { PAIROFCLEATS_TESTING: '1', PAIROFCLEATS_THREADS: '2' });
assert.deepEqual(buildBenchEnvironmentMetadata({ ...raw, PAIROFCLEATS_API_TOKEN: 'rotated-secret' }), safe);
assert.deepEqual(buildBenchEnvironmentMetadata(Object.fromEntries(Object.entries(raw).reverse())), safe);
assert.notEqual(buildBenchEnvironmentMetadata({ ...raw, PAIROFCLEATS_THREADS: '3' }).fingerprint, safe.fingerprint);
assert.equal(raw.PAIROFCLEATS_API_TOKEN, secret, 'execution environment remains untouched');
let observedSecret = false;
const lazy = { PAIROFCLEATS_THREADS: '2' };
Object.defineProperty(lazy, 'PAIROFCLEATS_API_TOKEN', { enumerable: true, get() { observedSecret = true; return secret; } });
assert.equal(JSON.stringify(buildBenchEnvironmentMetadata(lazy)).includes(secret), false);
assert.equal(observedSecret, false);

const output = await buildReportOutput({
  configPath: path.join(tempRoot, 'repos.json'),
  cacheRoot: path.join(tempRoot, 'cache'),
  resultsRoot,
  results: [],
  config: {},
  environmentMetadata
});

assert.equal(output.environment?.fingerprint, environmentMetadata.fingerprint, 'expected report output to carry environment fingerprint');
assert.equal(output.environment?.selected?.PAIROFCLEATS_TESTING, '1', 'expected report output to carry selected environment metadata');

const receiptRoot = await makeTempDir('bench-safe-environment-');
const ledger = createBenchRunLedger({ logsRoot: receiptRoot, runSuffix: 'synthetic',
  diagnosticsRoot: path.join(receiptRoot, 'diagnostics'), resultsRoot: receiptRoot });
try {
  ledger.recordRunStarted({ environment: safe });
  await ledger.flush();
  assert.equal((await fs.readFile(ledger.ledgerPath, 'utf8')).includes(secret), false);
  const safeOutput = await buildReportOutput({ configPath: path.join(receiptRoot, 'repos.json'),
    cacheRoot: path.join(receiptRoot, 'cache'), resultsRoot: receiptRoot, results: [], config: {}, environmentMetadata: safe });
  const summary = await ledger.buildSummary({ output: safeOutput, endState: 'completed' });
  assert.equal(JSON.stringify({ safeOutput, summary }).includes(secret), false);
  assert.equal(summary.environment.fingerprint, safe.fingerprint);
} finally { await ledger.close(); await rmDirRecursive(receiptRoot); }

console.log('bench language report environment metadata test passed');
