import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeSetupDiagnostics, NATIVE_DIAGNOSTIC_LIMITS, isNativeDiagnosticFailure } from '../../../tools/setup/native-diagnostics.js';
import { runNativeSetupCommand } from '../../../tools/setup/native-command-result.js';
import { withCheckoutMutation, retireCheckoutMutationSession } from '../../../tools/setup/checkout-mutation.js';
import { CHECKOUT_MUTATION_LOCK } from '../../../tools/setup/checkout-bootstrap-paths.js';
import { getCheckoutEvidenceFiles } from '../../../tools/setup/checkout-evidence-files.js';
import { makeTempDir } from '../../helpers/temp.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { spawn } from 'node:child_process';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-diagnostic-ownership/')[1];
assert.ok(['exact-bytes-and-tails', 'attempt-history-and-concurrency', 'original-log-failures', 'bounded-admission-and-output',
  'unknown-close-retains-owner', 'original-structured-output', 'structured-output-fences', 'first-byte-observation', 'unknown-write-retains-owner',
  'handled-live-child-retains-root', 'original-io-provider-capture', 'checkout-wide-storage-budget',
  'checkout-wide-attempt-budget', 'checkout-wide-short-write-accounting'].includes(mode));
const root = await makeTempDir('native-diagnostics-');
const retainedFixtureFds = new Set();
let liveChild = null, childClosed = false;
const childClosure = Promise.withResolvers();
const commandOptions = { cwd: root, stdio: 'pipe', timeoutMs: 5000, maxOutputBytes: 16,
  rejectOnNonZeroExit: false, killTree: false, windowsHide: true };
const compact = { ...NATIVE_DIAGNOSTIC_LIMITS, attempts: 8, diskBytes: 1024 * 1024, attemptBytes: 128 * 1024, tailBytes: 64 };
try {
  if (mode === 'checkout-wide-storage-budget') {
    await withCheckoutMutation(root, async session => {
      const first = createNativeSetupDiagnostics(root, session), second = createNativeSetupDiagnostics(root, session);
      const bytes = Buffer.alloc(7 * 1024 * 1024, 0x61); let calls = 0;
      const command = diagnostics => diagnostics.run('explicit-fixture-output', [], commandOptions, async (command, args, options) => {
        calls++; options.onStdoutChunk(bytes); return { exitCode: 0, signal: null };
      });
      for (const diagnostics of [first, second, first, second]) {
        const result = await command(diagnostics); assert.equal(result.diagnostics.evidenceComplete, true);
        assert.ok(Buffer.byteLength(result.stdout) <= NATIVE_DIAGNOSTIC_LIMITS.tailBytes);
        assert.deepEqual(fs.readFileSync(result.diagnostics.logs[0].path), bytes);
      }
      const failure = await command(second).catch(error => error);
      assert.equal(calls, 5); assert.equal(isNativeDiagnosticFailure(failure), true);
      assert.equal(failure.diagnostics.evidenceComplete, false);
      assert.equal(failure.diagnostics.logs[0].writtenBytes, 0);
      const budget = first.snapshot().checkoutBudget;
      assert.deepEqual(second.snapshot().checkoutBudget, budget);
      assert.equal(budget.rawBytes, bytes.length * 4); assert.equal(budget.reservedRawBytes, 0);
      assert.equal(budget.attempts, 5); assert.ok(budget.retainedBytes <= budget.limits.bytes);
      assert.equal(first.snapshot().writtenBytes, bytes.length * 2);
      assert.equal(second.snapshot().writtenBytes, bytes.length * 2);
    });
  } else if (mode === 'checkout-wide-attempt-budget') {
    await withCheckoutMutation(root, async session => {
      const group = getCheckoutEvidenceFiles(root, session);
      // Reserve earlier attempts through the same owner without launching 383
      // redundant fixture children or publishing fabricated attempt records.
      for (let i = 1; i < group.nativeBudget().limits.attempts; i++) group.reserveNativeAttempt();
      const first = createNativeSetupDiagnostics(root, session), second = createNativeSetupDiagnostics(root, session);
      let calls = 0;
      const result = await first.run('explicit-fixture-empty-output', [], commandOptions, async () => {
        calls++; return { exitCode: 0, signal: null };
      });
      assert.equal(result.diagnostics.evidenceComplete, true);
      const failure = await second.run('explicit-fixture-never-admitted', [], commandOptions, () => {
        calls++; assert.fail('a second logger cannot reset the original checkout attempt allowance');
      }).catch(error => error);
      assert.equal(isNativeDiagnosticFailure(failure), true); assert.equal(calls, 1);
      assert.equal(second.snapshot().directory, null); assert.equal(second.snapshot().attempts, 0);
      assert.equal(group.nativeBudget().attempts, group.nativeBudget().limits.attempts);
    });
  } else if (mode === 'checkout-wide-short-write-accounting') {
    await withCheckoutMutation(root, async session => {
      let writes = 0;
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact, io: { ...fs,
        writeSync(fd, bytes, offset, length, position) {
          writes++; return fs.writeSync(fd, bytes, offset, Math.min(length, 3), position);
        }
      } });
      const result = await diagnostics.run('explicit-fixture-short-writes', [], commandOptions, async (command, args, options) => {
        options.onStdoutChunk(Buffer.from('eight!!!')); return { exitCode: 0, signal: null };
      });
      assert.equal(writes, 3); assert.equal(result.diagnostics.evidenceComplete, true);
      assert.equal(diagnostics.readOutput(result.diagnostics, 'stdout'), 'eight!!!');
      const budget = diagnostics.snapshot().checkoutBudget;
      assert.equal(budget.rawBytes, 8); assert.equal(budget.reservedRawBytes, 0);
      assert.equal(budget.retainedBytes, budget.metadataBytes + 8);
    });
  } else if (mode === 'original-io-provider-capture') {
    await withCheckoutMutation(root, async session => {
      let opens = 0, closes = 0;
      const io = { ...fs, openSync(...args) { assert.equal(this, io); opens++; return fs.openSync(...args); },
        closeSync(fd) { assert.equal(this, io); closes++; return fs.closeSync(fd); } };
      const diagnostics = createNativeSetupDiagnostics(root, session, { io, limits: compact });
      io.openSync = () => assert.fail('caller replaced captured log open');
      io.closeSync = () => assert.fail('caller replaced captured log close');
      const result = await diagnostics.run('inert-fixture-command', [], commandOptions, async (command, args, options) => {
        options.onStdoutChunk(Buffer.from('original provider bytes')); return { exitCode: 0, signal: null };
      });
      assert.equal(result.diagnostics.evidenceComplete, true); assert.equal(opens, 2); assert.equal(closes, 2);
      assert.equal(diagnostics.readOutput(result.diagnostics, 'stdout'), 'original provider bytes');
    });
  } else if (mode === 'handled-live-child-retains-root') {
    const original = Object.assign(new Error('original child is still waiting for its input owner'), {
      cacheOwnershipPending: true, cacheOwnershipReleased: () => childClosed
    });
    const failure = await withCheckoutMutation(root, async session => {
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact });
      await assert.rejects(diagnostics.run(process.execPath,
        ['-e', 'process.stdout.write("child-ready\\n");process.stdin.resume();'], commandOptions,
        async (command, args, options) => {
          // Deliberately incomplete adapter: its logical rejection precedes
          // this actual child's close. The original guard retains authority.
          liveChild = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
          liveChild.once('close', (code, signal) => { childClosed = true; childClosure.resolve({ code, signal }); });
          await new Promise((resolve, reject) => {
            let output = '';
            const timer = setTimeout(() => finish(new Error('owned child did not become ready')), 5000);
            const finish = error => {
              clearTimeout(timer); liveChild.stdout.off('data', receive); liveChild.off('error', finish);
              if (error) reject(error); else resolve();
            };
            const receive = chunk => {
              try {
                options.onStdoutChunk(chunk); output += chunk.toString(); assert.ok(output.length <= 64);
                if (output.includes('\n')) { assert.equal(output, 'child-ready\n'); finish(); }
              } catch (error) { finish(error); }
            };
            liveChild.once('error', finish); liveChild.stdout.on('data', receive);
          });
          throw original;
        }), error => errorGraphIncludes(error, original));
      // Handling the API rejection cannot retire the real child on its behalf.
    }).catch(error => error);
    assert.ok(failure, 'a handled live-child failure must retain the checkout');
    assert.equal(errorGraphIncludes(failure, original), true); assert.equal(childClosed, false);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    assert.equal(failure.cacheOwnershipReleased(), false);
    original.cacheOwnershipPending = false; original.cacheOwnershipReleased = () => true;
    await assert.rejects(retireCheckoutMutationSession(failure.checkoutMutationSession));
    assert.equal(childClosed, false); assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), true);
    liveChild.stdin.end();
    assert.deepEqual(await childClosure.promise, { code: 0, signal: null });
    await retireCheckoutMutationSession(failure.checkoutMutationSession);
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.equal(fs.existsSync(path.join(root, CHECKOUT_MUTATION_LOCK)), false);
  } else if (['unknown-close-retains-owner', 'unknown-write-retains-owner'].includes(mode)) {
    const original = Object.freeze(new Error('actual close returned no confirmation'));
    const io = mode === 'unknown-close-retains-owner' ? { ...fs, closeSync(fd) { fs.closeSync(fd); throw original; } } : { ...fs,
      openSync(...args) { const fd = fs.openSync(...args); retainedFixtureFds.add(fd); return fd; },
      writeSync() { return false; }, closeSync(fd) { retainedFixtureFds.delete(fd); return fs.closeSync(fd); }
    };
    const failure = await withCheckoutMutation(root, async session => {
      const diagnostics = createNativeSetupDiagnostics(root, session, { io, limits: compact });
      await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("bytes");'], commandOptions, { diagnostics });
    }).catch(error => error);
    if (mode === 'unknown-close-retains-owner') assert.equal(errorGraphIncludes(failure, original), true);
    else assert.equal(retainedFixtureFds.size, 1, 'an unknown write result cannot authorize descriptor close');
    assert.equal(failure.cacheOwnershipReleased(), false);
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
    } else if (mode === 'original-structured-output') {
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact });
      const result = await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write(JSON.stringify({value:42,source:"x".repeat(8192)}));'], commandOptions, { diagnostics });
      assert.equal(result.ok, true); assert.ok(Buffer.byteLength(result.stdout) <= compact.tailBytes);
      const full = diagnostics.readOutput(result.diagnostics, 'stdout');
      assert.deepEqual(JSON.parse(full), { value: 42, source: 'x'.repeat(8192) });
      assert.equal(diagnostics.readOutput(result.diagnostics, 'stderr'), '');
      assert.throws(() => diagnostics.readOutput({ ...result.diagnostics }, 'stdout'), TypeError);
      assert.throws(() => diagnostics.readOutput(result.diagnostics, 'other'), TypeError);
      assert.throws(() => diagnostics.readOutput(result.diagnostics, 'stdout', { maxBytes: 1024 * 1024 + 1 }), TypeError);
      const file = result.diagnostics.logs[0].path;
      fs.renameSync(file, file + '.original'); fs.copyFileSync(file + '.original', file);
      assert.throws(() => diagnostics.readOutput(result.diagnostics, 'stdout'), error => isNativeDiagnosticFailure(error));
      assert.equal(fs.existsSync(file + '.original'), true, 'read admission never deletes either original or replacement evidence');
    } else if (mode === 'structured-output-fences') {
      const invalid = createNativeSetupDiagnostics(root, session, { limits: compact });
      const bytes = await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write(Buffer.from([123,34,116,34,58,34,255,34,125]));'], commandOptions, { diagnostics: invalid });
      assert.equal(bytes.diagnostics.evidenceComplete, true, 'raw invalid UTF-8 bytes remain complete evidence');
      assert.throws(() => invalid.readOutput(bytes.diagnostics, 'stdout'), error => isNativeDiagnosticFailure(error));
      const bounded = createNativeSetupDiagnostics(root, session, { limits: compact });
      const result = await runNativeSetupCommand(process.execPath, ['--eval', 'process.stdout.write("x".repeat(4096));'], commandOptions, { diagnostics: bounded });
      assert.throws(() => bounded.readOutput(result.diagnostics, 'stdout', { maxBytes: 128 }), error => isNativeDiagnosticFailure(error));
    } else if (mode === 'first-byte-observation') {
      const diagnostics = createNativeSetupDiagnostics(root, session, { limits: compact }), events = [];
      const result = await runNativeSetupCommand(process.execPath,
        ['--eval', 'process.stdout.write("one");setTimeout(()=>{process.stdout.write("two");process.stderr.write("error");},5);'],
        commandOptions, { diagnostics, observeOutput: event => { events.push(event); assert.equal(Object.isFrozen(event), true); } });
      assert.equal(result.ok, true); assert.equal(events.length, 2, 'first bytes are observed once per actual attempt stream');
      for (const channel of ['stdout', 'stderr']) {
        const event = events.find(event => event.channel === channel), log = result.diagnostics.logs.find(log => log.channel === channel);
        assert.equal(event.attempt, result.diagnostics.attempt); assert.equal(event.path, log.path);
        assert.ok(event.observedBytes > 0 && event.observedBytes <= log.observedBytes);
      }
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
} finally {
  if (liveChild && !childClosed) {
    liveChild.stdin.end();
    const cleanup = setTimeout(() => liveChild.kill('SIGKILL'), 2000); cleanup.unref();
    try { await childClosure.promise; } finally { clearTimeout(cleanup); }
  }
  for (const fd of retainedFixtureFds) fs.closeSync(fd); // Exact no-work injected descriptors, never reused by this fixture.
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('Native attempt logs preserve bounded raw bytes, exact descriptor ownership and independent evidence failures');
