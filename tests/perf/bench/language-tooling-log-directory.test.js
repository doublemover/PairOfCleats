#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveBenchmarkToolingLogs } from '../../../tools/bench/language/tooling-logs.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { getToolingConfig } from '../../../tools/shared/dict-utils.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `bench-tooling-logs-${process.pid}-${Date.now()}`);
const receiptPath = path.join(root, 'results', 'prerequisites', 'checkout-one', 'receipt.json');
const selected = resolveBenchmarkToolingLogs({ receiptPath, env: { PATH: 'fixture-path' } });
assert.equal(selected.dir, path.join(path.dirname(receiptPath), 'tooling-logs'));
assert.equal(selected.source, 'benchmark-default');
assert.equal(selected.env.PATH, 'fixture-path');
assert.equal(getEnvConfig(selected.env).toolingLogDir, selected.dir);
assert.notEqual(selected.dir, resolveBenchmarkToolingLogs({ receiptPath: receiptPath.replace('checkout-one', 'checkout-two') }).dir);
assert.equal(resolveBenchmarkToolingLogs({ outFile: path.join(root, 'legacy-result.json') }).dir, path.join(root, 'tooling-logs'));
assert.equal(resolveBenchmarkToolingLogs({ userConfig: { tooling: { logDir: ' relative-log ' } } }).dir, 'relative-log');
const explicit = resolveBenchmarkToolingLogs({ env: { PAIROFCLEATS_TOOLING_LOG_DIR: ' launch-log ' },
  userConfig: { tooling: { logDir: 'config-log' } } });
assert.equal(explicit.dir, 'launch-log');
assert.equal(explicit.source, 'launch-environment');
assert.throws(() => resolveBenchmarkToolingLogs({}), /durable receipt or result path/);
assert.equal(await fs.access(root).then(() => true, () => false), false, 'directory selection performs no writes');
await withTemporaryEnv({ PAIROFCLEATS_TOOLING_LOG_DIR: selected.dir }, () => {
  assert.equal(getToolingConfig(process.cwd(), { tooling: { logDir: 'config-log' } }).logDir, selected.dir,
    'the actual child configuration resolver consumes the benchmark-selected path');
});
await withTemporaryEnv({ PAIROFCLEATS_TOOLING_LOG_DIR: '' }, () => {
  assert.equal(getToolingConfig(process.cwd(), { tooling: { logDir: 'config-log' } }).logDir, 'config-log');
  assert.equal(getToolingConfig(process.cwd(), {}).logDir, '', 'ordinary indexing defaults remain unchanged');
});
console.log('Benchmark tooling log selection is durable, per-checkout and consumed by the actual config resolver.');
