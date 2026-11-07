import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishSqliteBenchSource } from '../../../tools/bench/sqlite/shared.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('sqlite-benchmark-published-identity');
const bundleDir = path.join(dir, 'bundles'), file = 'src/fixture café.js';
const chunks = [{ id: 0, name: 'alpha', tokens: ['alpha', 'alpha', 'β'], start: 0, end: 4, kind: 'function' }];
const options = { bundleDir, file, chunks, mtimeMs: 1000 };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
try {
  const first = await publishSqliteBenchSource(options), reused = await publishSqliteBenchSource(options);
  assert.deepEqual(reused, first, 'an existing immutable fixture cannot change the manifest checksum algorithm');
  assert.equal(first.bundleInventory.length, 1);
  const payload = JSON.parse(await fs.readFile(path.join(bundleDir, first.bundles[0]), 'utf8'));
  const independent = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  assert.equal(first.bundleInventory[0].hash, independent);
  assert.equal(first.bundleChecksum, 'sha256:' + independent);
  const code = "import {publishSqliteBenchSource} from './tools/bench/sqlite/shared.js'; const options=JSON.parse(process.argv[1]); console.log(JSON.stringify(await publishSqliteBenchSource(options)));";
  for (const selected of [options, { ...options, bundleDir: path.join(dir, 'fresh-process') }]) {
    const child = await spawnSubprocess(process.execPath, ['--input-type=module', '-e', code, JSON.stringify(selected)],
      { timeoutMs: 5000, maxOutputBytes: 65536, captureStdout: true, captureStderr: true, outputMode: 'string', rejectOnNonZeroExit: true });
    assert.equal(child.stderr, ''); assert.equal(child.outputCapture.stdout.truncated, false);
    assert.deepEqual(JSON.parse(child.stdout), first, 'fresh process and independent fixture root preserve the same actual manifest identity');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('SQLite benchmark manifest identity is stable across original publication, reuse and fresh processes.');
