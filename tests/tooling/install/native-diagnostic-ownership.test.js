import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeSetupDiagnostics, NATIVE_DIAGNOSTIC_LIMITS, isNativeDiagnosticFailure } from '../../../tools/setup/native-diagnostics.js';
import { runNativeSetupCommand } from '../../../tools/setup/native-command-result.js';
import { withCheckoutMutation } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-diagnostic-ownership/')[1];
assert.ok(['exact-bytes-and-tails', 'attempt-history-and-concurrency', 'original-log-failures', 'bounded-admission-and-output', 'unknown-close-retains-owner'].includes(mode));
const root = await makeTempDir('native-diagnostics-');
const commandOptions = { cwd: root, stdio: 'pipe', timeoutMs: 5000, maxOutputBytes: 16,
  rejectOnNonZeroExit: false, killTree: false, windowsHide: true };
const compact = { ...NATIVE_DIAGNOSTIC_LIMITS, attempts: 8, diskBytes: 1024 * 1024, attemptBytes: 128 * 1024, tailBytes: 64 };
try {
  if (mode === 'unknown-close-retains-owner') {
    const original = Object.freeze(new Error('actual close returned no confirmation'));
    const io = { ...fs, closeSync(fd) { fs.closeSync(fd); throw original; } };
    const failure = await withCheckoutMutation(root, async session => {
      const diagnostics = createNativeSetupDiagnostics(root, session, { io, limits: compact });
      await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("bytes");'], commandOptions, { diagnostics });
    }).catch(error => error);
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    // The fixture's intercepted close did close each real descriptor before
    // throwing. Production is correct to retain uncertainty rather than infer it.
  } else await withCheckoutMutation(root, async session => {
    if (mode === 'exact-bytes-and-tails') {
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact });
      const bytes = Buffer.from(Array.from({ length: 65536 }, (_, index) => index % 256));
      const result = await runNativeSetupCommand(process.execPath,
        ['--eval', 'const b=Buffer.from(Array.from({length:65536},(_,i)=>i%256));process.stdout.write(b);process.stderr.write(Buffer.from(b).reverse());'],
        commandOptions, { diagnostics });
      assert.equal(result.ok, true); assert.equal(result.diagnostics.evidenceComplete, true);
      assert.equal(result.diagnostics.metadataPublished, true);
      for (const [index, log] of result.diagnostics.logs.entries()) {
        const expected = index ? Buffer.from(bytes).reverse() : bytes;
        assert.deepEqual(fs.readFileSync(log.path), expected);
        assert.equal(log.sha256, createHash('sha256').update(expected).digest('hex'));
        assert.equal(log.writtenBytes, expected.length); assert.equal(log.observedBytes, expected.length);
        assert.ok(log.capture.retainedBytes <= compact.tailBytes); assert.ok(log.capture.retainedBufferBytes <= compact.tailBytes);
        assert.ok(log.capture.outputBytes <= compact.tailBytes);
      }
      const persisted = JSON.parse(fs.readFileSync(result.diagnosticsPath, 'utf8'));
      assert.equal(persisted.byteStreamsComplete, true); assert.equal(persisted.compiler.exitCode, 0);
      assert.equal(persisted.runId, session.runId);
      const snapshot = diagnostics.snapshot(); assert.equal(snapshot.attempts, 1); assert.equal(snapshot.writtenBytes, 131072);
      assert.ok(snapshot.writtenBytes + snapshot.reservedBytes <= compact.diskBytes);
    } else if (mode === 'attempt-history-and-concurrency') {
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact });
      const results = await Promise.all([
        runNativeSetupCommand(process.execPath, ['--eval', 'setTimeout(()=>{process.stdout.write("prebuild failed");process.exitCode=7;},15);'], commandOptions, { diagnostics }),
        runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("independent build");'], commandOptions, { diagnostics })
      ]);
      assert.equal(results[0].ok, false); assert.equal(results[1].ok, true);
      const fallback = await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("source repaired");'], commandOptions, { diagnostics });
      assert.equal(fallback.ok, true);
      const records = diagnostics.snapshot().records;
      assert.deepEqual(records.map(record => record.attempt).sort((a, b) => a - b), [1, 2, 3]);
      assert.equal(records.find(record => record.attempt === 1).compiler.exitCode, 7);
      assert.equal(new Set(records.flatMap(record => record.logs.map(log => log.path))).size, 6);
      for (const result of [...results, fallback]) assert.equal(fs.existsSync(result.diagnosticsPath), true);
    } else if (mode === 'original-log-failures') {
      for (const original of [false, 0, '', null, undefined]) {
        const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact, io: { ...fs, writeSync() { throw original; } } });
        const failure = await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("actual child bytes");setInterval(()=>{},1000);'],
          commandOptions, { diagnostics }).catch(error => error);
        assert.equal(isNativeDiagnosticFailure(failure), true); assert.equal(errorGraphIncludes(failure, original), true);
        assert.equal(failure.diagnostics.evidenceComplete, false); assert.equal(failure.diagnostics.compiler.exitCode, null);
        assert.equal(failure.cacheOwnershipReleased?.() ?? true, true, 'actual child and original descriptors settled despite evidence failure');
        const again = await runNativeSetupCommand(process.execPath, ['--eval', 'throw new Error("must not retry");'], commandOptions, { diagnostics }).catch(error => error);
        assert.equal(again, failure, 'a failed evidence owner cannot admit another command');
      }
      const original = Object.freeze(new Error('metadata publication failed'));
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact, publish: async () => { throw original; } });
      const failure = await runNativeSetupCommand(process.execPath, ['--eval', 'process.exitCode=7;'], commandOptions, { diagnostics }).catch(error => error);
      assert.equal(isNativeDiagnosticFailure(failure), true); assert.equal(errorGraphIncludes(failure, original), true);
      assert.equal(failure.result.exitCode, 7); assert.equal(failure.diagnostics.compiler.exitCode, 7);
      assert.equal(failure.diagnostics.metadataPublished, false); assert.equal(failure.diagnostics.evidenceComplete, false);
      const unconfirmed = createNativeSetupDiagnostics(root, session, { limits: compact, publish: async () => false });
      const unknown = await runNativeSetupCommand(process.execPath, ['--eval', ''], commandOptions, { diagnostics: unconfirmed }).catch(error => error);
      assert.equal(isNativeDiagnosticFailure(unknown), true); assert.equal(unknown.diagnostics.evidenceComplete, false);
      const invented = createNativeSetupDiagnostics(root, session, { limits: compact, publish: async destination => destination });
      const absent = await runNativeSetupCommand(process.execPath, ['--eval', ''], commandOptions, { diagnostics: invented }).catch(error => error);
      assert.equal(isNativeDiagnosticFailure(absent), true); assert.equal(absent.diagnostics.evidenceComplete, false);
    } else {
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: { ...compact, diskBytes: 65536 } });
      assert.equal((await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("one");'], commandOptions, { diagnostics })).ok, true);
      let spawned = false;
      const failure = await runNativeSetupCommand(process.execPath, ['--eval', ''], commandOptions,
        { diagnostics, spawn: () => { spawned = true; assert.fail('aggregate reservation exhausted before admission'); } }).catch(error => error);
      assert.equal(spawned, false); assert.equal(isNativeDiagnosticFailure(failure), true);
      assert.equal(diagnostics.snapshot().attempts, 1); assert.equal(diagnostics.snapshot().records.length, 1);
      const output = createNativeSetupDiagnostics(root, session, { limits: { ...compact, attemptBytes: 128 } });
      const overflow = await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write(Buffer.alloc(4096));'],
        commandOptions, { diagnostics: output }).catch(error => error);
      assert.equal(isNativeDiagnosticFailure(overflow), true); assert.equal(overflow.diagnostics.evidenceComplete, false);
      assert.ok(output.snapshot().writtenBytes <= 128); assert.ok(overflow.diagnostics.logs[0].observedBytes > 128);
    }
  });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Native attempt logs preserve bounded raw bytes, exact descriptor ownership and independent evidence failures');
