import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import { collectBenchmarkArtifactReport, readBenchmarkArtifactReport } from '../../../tools/bench/language/artifact-report.js';
import { observeStorageResource } from '../../../src/shared/storage/failure-observation.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: actual hidden child/capture owner and actual artifact CLI. A
// complete command receipt does not qualify indexed work or performance.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['captured-json', 'actual-report', 'nonzero', 'signal', 'truncated', 'encoding-loss', 'malformed',
  'unrelated', 'wrong-root', 'missing-capture', 'diagnostics', 'pending-result'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'bench-artifact-admission-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), extraEnv: { PAIROFCLEATS_HOME: path.join(root, 'home'), PAIROFCLEATS_TRUSTED_CONFIG: null } });
try {
  if (selected === 'actual-report') {
    const actual = collectBenchmarkArtifactReport({ repoRoot: root, env: process.env });
    assert.equal(actual.report.repo.root, root);
    assert.equal(actual.receipt.state, 'complete-command-output');
    assert.equal(actual.receipt.stdout.truncated, false);
    assert.equal(actual.receipt.scope, 'artifact-report-command');
  } else {
    const other = path.join(root, 'other'); await fs.mkdir(other);
    const payload = { repo: { root: selected === 'wrong-root' ? other : root }, throughput: { code: null } };
    let script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`;
    if (selected === 'nonzero') script += 'process.exitCode = 7;';
    if (selected === 'signal') script += 'process.kill(process.pid, "SIGTERM");';
    if (selected === 'truncated') script += 'process.stdout.write(" ".repeat(8192));';
    if (selected === 'encoding-loss') script += 'process.stdout.write(Buffer.from([255]));';
    if (selected === 'malformed') script = 'process.stdout.write("{malformed");';
    if (selected === 'unrelated') script = 'process.stdout.write("{}");';
    if (selected === 'diagnostics') script += 'process.stderr.write("expected diagnostic ".repeat(300));';
    const result = spawnSubprocessSync(process.execPath, ['-e', script], {
      cwd: root, env: process.env, captureStdout: true, captureStderr: true, outputMode: 'string',
      maxOutputBytes: selected === 'truncated' ? 4096 : 16384, timeoutMs: 5000, rejectOnNonZeroExit: false
    });
    if (selected === 'captured-json' || selected === 'diagnostics') {
      const actual = readBenchmarkArtifactReport(result, { repoRoot: root });
      assert.deepEqual(actual.report, payload);
      assert.equal(actual.receipt.stderr.hasDiagnostics, selected === 'diagnostics');
      if (selected === 'diagnostics') {
        assert.match(actual.receipt.stderr.preview, /expected diagnostic/);
        assert.equal(actual.receipt.stderr.preview.length, 4096);
        assert.equal(actual.receipt.stderr.previewTruncated, true);
      }
    } else if (selected === 'pending-result') {
      let settled = false;
      const pending = Object.freeze({ ...result, cacheOwnershipPending: true,
        cacheOwnershipReleased() { assert.equal(this, pending); return settled; } });
      let failure;
      assert.throws(() => readBenchmarkArtifactReport(pending, { repoRoot: root }), error => { failure = error; return true; });
      assert.equal(observeStorageResource(failure).isSettled(), false);
      settled = true;
      assert.equal(observeStorageResource(failure).isSettled(), true);
    } else {
      if (selected === 'missing-capture') delete result.outputCapture;
      const reasons = { nonzero: 'child-failed', signal: 'child-failed', truncated: 'capture-incomplete',
        'encoding-loss': 'capture-incomplete', malformed: 'malformed-json', unrelated: 'unsupported-report',
        'wrong-root': 'repository-mismatch', 'missing-capture': 'capture-incomplete' };
      assert.throws(() => readBenchmarkArtifactReport(result, { repoRoot: root }), error => {
        assert.equal(error.code, 'ERR_BENCH_ARTIFACT_REPORT');
        assert.equal(error.reason, reasons[selected]); assert.equal(error.artifactReportChild, result);
        return true;
      });
    }
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`benchmark artifact-report admission ${selected} passed`);
