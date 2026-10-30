import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { spawnSubprocess } from '../../src/shared/subprocess/runner.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('actual-adapter-cost-prepared-policy');
const relative = path.relative(process.cwd(), dir);
assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
let failed = false, failure;
try {
  // This explicit unsupported-route control ends before model selection. It
  // supplies no graph/tokenizer and cannot be counted as inference evidence.
  const manifest = path.join(dir, 'direct-route.json');
  await fs.writeFile(manifest, JSON.stringify({ schemaVersion: 1, provider: 'onnx' }));
  for (const entry of ['tests/fixtures/benchmarks/actual-adapter-costs.js', 'tests/perf/qualification/actual-adapter-costs.js']) {
    const output = path.join(dir, entry.includes('/fixtures/') ? 'worker' : 'controller');
    const args = [entry, '--manifest', manifest, '--cohort', 'cold', '--route', 'prepared', '--out', output];
    if (entry.includes('/fixtures/')) args.push('--arm', 'current');
    const result = await spawnSubprocess(process.execPath, args, { timeoutMs: 10000, maxOutputBytes: 32768,
      outputMode: 'string', captureStdout: true, captureStderr: true, rejectOnNonZeroExit: false, killTree: true });
    // This owner fulfills only on the original child's close; its timeout
    // rejects even with rejectOnNonZeroExit:false and is not a result flag.
    assert.equal(result.exitCode, 1); assert.equal(result.signal, null);
    assert.ok(Number.isFinite(result.durationMs) && result.durationMs >= 0 && result.durationMs < 10000);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Direct ONNX has no public prepare\/embedPrepared capability/);
    assert.doesNotMatch(result.stderr, /BOOTSTRAP REQUIRED|ERR_MODULE_NOT_FOUND|ONNX model path not found/);
    if (entry.includes('/fixtures/')) assert.deepEqual(await fs.readdir(output), [], 'Denied route owns no runtime root or model work.');
    else await assert.rejects(fs.stat(output), { code: 'ENOENT' }, 'The controller rejects before opening its campaign directory.');
  }
} catch (error) { failed = true; failure = error; }
finally {
  try { await fs.rm(dir, { recursive: true }); }
  catch (cleanup) { failure = failed ? addStorageFailureContext(failure, {}, cleanup, { secondaryPresent: true }) : cleanup; failed = true; }
}
if (failed) throw failure;
console.log('Actual adapter cost entrypoints explicitly reject unsupported direct ONNX prepared inference.');
