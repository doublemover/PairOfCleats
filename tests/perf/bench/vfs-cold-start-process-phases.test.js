import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const script = fileURLToPath(new URL('../../../tools/bench/vfs/cold-start-cache.js', import.meta.url));
const { dir } = await prepareIsolatedTestCacheDir('vfs-phases');
try {
  const result = await spawnSubprocess(process.execPath, [script, '--docs', '2', '--doc-bytes', '8', '--samples', '2', '--json'], {
    timeoutMs: 30000, maxOutputBytes: 1024 * 1024, outputEncoding: 'utf8', outputMode: 'string',
    captureStdout: true, captureStderr: true, rejectOnNonZeroExit: true, killTree: true
  });
  assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 2); assert.equal(report.state, 'qualified-phases'); assert.equal(report.fixtureCleanup, 'completed');
  const base = path.resolve('.tmp/dev/benchmarks/vfs-cold'), relative = path.relative(base, report.fixtureRoot);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  await assert.rejects(fs.stat(report.fixtureRoot), { code: 'ENOENT' });
  assert.equal(report.workload.actualUtf8Bytes, 16); assert.equal(report.samples, 2);
  assert.deepEqual(report.order.map(value => value.mode), ['cold', 'warm', 'hot', 'cold', 'hot', 'warm']);
  for (const mode of ['cold', 'warm', 'hot']) {
    assert.equal(report[mode].state, 'qualified-phase'); assert.equal(report[mode].completedSamples, 2);
    assert.equal(report[mode].completedDocuments, 4);
    for (const sample of report[mode].samples) {
      assert.equal(sample.state, 'qualified-phase'); assert.equal(sample.counts.documents, 2);
      assert.equal(sample.consumerParity.state, 'byte-identical'); assert.equal(sample.consumerParity.bytes, 16);
      if (mode === 'cold') { assert.equal(sample.counts.created, 2); assert.equal(sample.initialCache.loadedEntries, 0); }
      if (mode === 'warm') { assert.equal(sample.counts.persistedHits, 2); assert.equal(sample.initialCache.loadedEntries, 2); }
      if (mode === 'hot') { assert.equal(sample.counts.memoryHits, 2); assert.equal(sample.initialCache, null); }
      if (mode !== 'hot') assert.equal(sample.finalCache.flushes - sample.initialCache.flushes, 1);
    }
  }
  await fs.writeFile(path.join(dir, 'sentinel'), 'unowned fixture must remain');
  const rejected = await spawnSubprocess(process.execPath, [script, '--mode', 'cold', '--root', dir,
    '--docs', '2', '--doc-bytes', '8', '--samples', '1', '--json'], {
    timeoutMs: 30000, maxOutputBytes: 65536, outputEncoding: 'utf8', outputMode: 'string',
    captureStdout: true, captureStderr: true, rejectOnNonZeroExit: false, killTree: true
  });
  assert.notEqual(rejected.exitCode, 0); assert.match(rejected.stderr, /ENOENT|owned fixture/u);
  assert.deepEqual(await fs.readdir(dir), ['sentinel']);
  assert.equal(await fs.readFile(path.join(dir, 'sentinel'), 'utf8'), 'unowned fixture must remain');
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Real VFS benchmark processes retain independent cold repetitions, observed warm/hot phases and owned-only cleanup.');
