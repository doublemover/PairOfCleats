import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWindowsCdbCollector, isWindowsCdbCollector, runWindowsCdbCollector,
  getWindowsCdbFailureResult, getWindowsCdbSession, WINDOWS_CDB_COMMANDS } from '../../../tools/shared/windows-cdb-collector.js';
import { WINDOWS_CDB_CHILD_CONTEXT } from '../../../tools/shared/windows-cdb-protocol.js';
import { runSqliteDenseWithBoundary } from '../../../tools/build/embeddings/sqlite-dense-isolate.js';
import { createWindowsMinidumpFixture } from '../../helpers/windows-minidump-fixture.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { skip } from '../../helpers/skip.js';

// UNVALIDATED: real bounded evidence IO, fixture-controlled debugger only.
// These synthetic dumps/statuses cannot qualify real native crash capture.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const cases = ['owned-dump', 'normal-exit', 'simulated-exit', 'no-dump', 'wrong-pid', 'malformed-dump',
  'missing-launch', 'wrong-token', 'bad-reply', 'debugger-failure', 'launch-failure', 'pending-result',
  'pending-error', 'unexpected-entry', 'oversize-dump', 'runtime-changed', 'capture-write-failure',
  'metadata-release-failure', 'forged-capability', 'relative-path', 'untrusted-runner', 'revoked-trust',
  'boundary-native', 'boundary-collector-failure', 'boundary-forged', 'boundary-dual-runner',
  'progress-valid', 'progress-partial', 'progress-foreign'];
assert.ok(cases.includes(selected));
if (process.platform !== 'win32' || process.arch !== 'x64') {
  assert.throws(() => createWindowsCdbCollector({}), { reason: 'unsupported-platform' });
  skip('CDB collector IO controls require Windows x64; portable minidump structure controls have a separate owner.');
}
const { dir: root } = await prepareIsolatedTestCacheDir(`windows-cdb-${selected}`);
const debuggerPath = path.join(root, 'cdb.exe'), captureRoot = path.join(root, 'captures');
await fs.writeFile(debuggerPath, 'fixture debugger identity only');
let passed = false, ready = false, launches = 0, attempt = null, replay = null, failure = null;
const primary = Object.freeze(Object.assign(new Error('fixture debugger launch/write/release failure'), { code: 'EACCES' }));
const pending = Object.freeze({ exitCode: 0, stdout: '', stderr: '', cacheOwnershipReleased: () => ready });
const pendingError = Object.freeze(Object.assign(new Error('original debugger cleanup owner'), { cacheOwnershipReleased: () => ready }));
const open = fs.open, unlink = fs.unlink;
let injectWrite = true, injectRelease = true;
const runDebugger = async (command, args, options) => {
  launches++; attempt = options.cwd;
  assert.equal(command, await fs.realpath(debuggerPath)); assert.equal(options.killTree, true); assert.equal(options.detached, false);
  assert.equal(options.rejectOnNonZeroExit, false); assert.equal(options.timeoutMs, 30000);
  assert.ok(args.includes('-o')); assert.ok(args.includes('-noshell')); assert.ok(args.includes('-netsyms:no'));
  assert.ok(!args.includes('-pd')); assert.ok(!args.includes('-2')); assert.ok(!args.includes('-iae'));
  assert.equal(args.at(-2), await fs.realpath(process.execPath)); assert.equal(args.at(-1), path.join(attempt, 'entry.mjs'));
  const context = JSON.parse(options.env[WINDOWS_CDB_CHILD_CONTEXT]);
  assert.equal(context.directory, attempt); assert.equal(context.cwd, root);
  assert.equal(await fs.readFile(path.join(attempt, 'commands.txt'), 'utf8'), WINDOWS_CDB_COMMANDS);
  assert.ok(WINDOWS_CDB_COMMANDS.includes('.dump /m /u native.dmp')); assert.ok(!WINDOWS_CDB_COMMANDS.includes('/ma'));
  assert.ok(WINDOWS_CDB_COMMANDS.includes('~* k')); assert.ok(WINDOWS_CDB_COMMANDS.includes('lmv'));
  if (selected === 'launch-failure') throw primary;
  if (selected === 'pending-error') throw pendingError;
  if (selected === 'pending-result') return pending;
  const launch = { schemaVersion: 1, token: selected === 'wrong-token' ? 'foreign' : context.token,
    pid: 1234, node: process.version, abi: process.versions.modules, platform: 'win32', arch: 'x64' };
  if (selected !== 'missing-launch') await fs.writeFile(path.join(attempt, 'child-launch.json'), JSON.stringify(launch));
  if (selected.startsWith('progress-')) {
    const first = JSON.stringify({ schemaVersion: 1, token: context.token, pid: 1234, sequence: 1, phase: 'child:initialized' });
    const second = JSON.stringify({ schemaVersion: 1, token: context.token, pid: selected === 'progress-foreign' ? 4321 : 1234,
      sequence: 2, phase: 'sqlite:update-start' });
    await fs.writeFile(path.join(attempt, 'child-progress.ndjson'), `${first}\n${selected === 'progress-partial' ? '{"schemaVersion":' : `${second}\n`}`);
  }
  const stdout = selected === 'normal-exit' ? '{"skipped":false,"count":1}' : '';
  const stderr = 'exact original child diagnostic';
  await fs.writeFile(path.join(attempt, 'child-stdout.bin'), stdout);
  await fs.writeFile(path.join(attempt, 'child-stderr.bin'), stderr);
  if (['normal-exit', 'simulated-exit', 'bad-reply'].includes(selected)) {
    await fs.writeFile(path.join(attempt, 'child-exit.json'), JSON.stringify({ schemaVersion: 1,
      token: context.token, pid: 1234, exitCode: selected === 'simulated-exit' ? 3221225477 : selected === 'bad-reply' ? null : 0,
      outputFailure: null, outputCapture: Object.fromEntries([['stdout', stdout], ['stderr', stderr]].map(
        ([name, value]) => [name, { bytes: Buffer.byteLength(value), capturedBytes: Buffer.byteLength(value), truncated: false }])) }));
  } else if (selected !== 'no-dump') {
    const dump = selected === 'malformed-dump' ? Buffer.from('invalid dump') : createWindowsMinidumpFixture({ pid: selected === 'wrong-pid' ? 4321 : 1234 });
    await fs.writeFile(path.join(attempt, 'native_fixture.dmp'), dump);
    if (selected === 'oversize-dump') {
      const handle = await fs.open(path.join(attempt, 'native_fixture.dmp'), 'r+');
      try { await handle.truncate(17 * 1024 * 1024); } finally { await handle.close(); }
    }
  }
  if (selected === 'unexpected-entry') await fs.mkdir(path.join(attempt, 'foreign-directory'));
  if (selected === 'runtime-changed') await fs.writeFile(debuggerPath, 'changed debugger identity');
  return { exitCode: ['debugger-failure', 'boundary-collector-failure'].includes(selected) ? 1 : 0, signal: null,
    durationMs: 1, stdout: 'fixture exception context, all thread stacks and module output', stderr: '',
    outputCapture: { stdout: { truncated: false }, stderr: { truncated: false } } };
};
const make = extra => createWindowsCdbCollector({ debuggerPath, captureRoot, testRunDebugger: runDebugger, ...extra });
try {
  if (selected === 'relative-path') assert.throws(() => make({ debuggerPath: 'cdb.exe' }), { reason: 'explicit-bounded-configuration-required' });
  else if (selected === 'untrusted-runner') await withTemporaryEnv({ PAIROFCLEATS_TESTING: null }, async () => {
    assert.throws(() => make(), { reason: 'untrusted-test-runner' });
  });
  else {
    const collector = make(); assert.equal(isWindowsCdbCollector(collector), true);
    assert.equal(isWindowsCdbCollector(JSON.parse(JSON.stringify(collector))), false);
    if (selected === 'capture-write-failure') fs.open = async (file, flags, ...args) => {
      if (injectWrite && typeof file === 'string' && file.includes('capture.json') && typeof flags === 'string' && /[wx]/u.test(flags)) throw primary;
      return open(file, flags, ...args);
    };
    if (selected === 'metadata-release-failure') fs.unlink = async (file, ...args) => {
      if (injectRelease && launches > 0 && typeof file === 'string' && file.includes(`${path.sep}write-reservations${path.sep}`)) throw primary;
      return unlink(file, ...args);
    };
    const options = { script: 'process.stdout.write(JSON.stringify({count:1}));', cwd: root, env: { ...process.env } };
    const call = () => selected.startsWith('boundary-') ? runSqliteDenseWithBoundary({ root,
      indexRoot: root, mode: 'code', vectorsPath: path.join(root, 'vectors'), dims: 3,
      windowsCrashCollector: selected === 'boundary-forged' ? { ...collector } : collector,
      testRunChild: selected === 'boundary-dual-runner' ? () => assert.fail('conflicting runner must never launch') : null,
      crashLogger: { async persistForensicBundle(input) { replay = input.bundle; return null; } },
      logger: { warn() {} } }) : runWindowsCdbCollector(selected === 'forged-capability' ? { ...collector } : collector, options);
    let result;
    try {
      if (selected === 'revoked-trust') await withTemporaryEnv({ PAIROFCLEATS_TESTING: null }, call);
      else result = await call();
    } catch (error) { failure = error; }
    if (['owned-dump', 'normal-exit', 'simulated-exit', 'progress-valid', 'progress-partial'].includes(selected)) {
      assert.equal(failure, null); assert.equal(result.crashCapture.execution, 'fixture-controlled');
      assert.equal(result.crashCapture.nativeQualification, 'pending');
      const captured = selected === 'owned-dump' || selected.startsWith('progress-');
      assert.equal(result.crashCapture.status, captured ? 'captured' : 'no-dump');
      assert.equal(result.childResult.exitCode, selected === 'normal-exit' ? 0 : 3221225477);
      if (captured) {
        assert.equal(result.crashCapture.dump.processId, 1234); assert.equal(result.crashCapture.dump.exceptionHex, '0xc0000005');
        assert.equal(result.crashCapture.dumpFiles.length, 1); assert.match(result.crashCapture.dump.sha256, /^[a-f0-9]{64}$/u);
      } else assert.deepEqual(result.crashCapture.dumpFiles, []);
      if (selected.startsWith('progress-')) {
        assert.equal(result.crashCapture.progress.status, selected === 'progress-valid' ? 'recorded' : 'partial');
        assert.equal(result.crashCapture.progress.lastCompletedPhase, selected === 'progress-valid' ? 'sqlite:update-start' : 'child:initialized');
        assert.equal(result.crashCapture.diagnosticsComplete, selected === 'progress-valid');
      }
    } else {
      assert.ok(failure, `${selected} must fail without retry`);
      if (selected === 'launch-failure' || selected === 'capture-write-failure' || selected === 'metadata-release-failure') assert.ok(errorGraphIncludes(failure, primary));
      if (selected.startsWith('boundary-')) {
        if (['boundary-forged', 'boundary-dual-runner'].includes(selected)) assert.equal(failure.code, 'ERR_SQLITE_DENSE_ISOLATE_INPUT');
        else {
          assert.ok(replay); assert.equal(replay.child.nativeCrash, true); assert.equal(replay.child.exitCode, 3221225477);
          assert.equal(replay.crashCapture.status, selected === 'boundary-native' ? 'captured' : 'failed');
          assert.equal(replay.crashCapture.execution, 'fixture-controlled');
        }
      }
      if (['capture-write-failure', 'debugger-failure', 'metadata-release-failure'].includes(selected)) {
        const recorded = getWindowsCdbFailureResult(failure);
        assert.equal(recorded.childResult.exitCode, 3221225477); assert.equal(recorded.crashCapture.status, 'failed');
      }
      if (['pending-result', 'pending-error', 'metadata-release-failure'].includes(selected)) {
        assert.equal(failure.cacheOwnershipReleased(), false);
        const session = getWindowsCdbSession(failure); assert.ok(session);
        const reservationDirectory = path.join(captureRoot, '.capture-control', 'write-reservations');
        assert.equal((await fs.readdir(reservationDirectory)).length, 1);
        if (selected !== 'metadata-release-failure') await assert.rejects(session.releaseMetadata());
        ready = true; injectRelease = false;
        assert.equal(await session.releaseMetadata(), true); assert.equal(failure.cacheOwnershipReleased(), true);
        assert.deepEqual(await fs.readdir(reservationDirectory), []);
        assert.equal(launches, 1, 'metadata recovery must never repeat native/debugger work');
      }
    }
    if (attempt) {
      const record = JSON.parse(await fs.readFile(path.join(attempt, 'attempt.json'), 'utf8'));
      assert.equal(record.byteBudget.enforcement, 'cooperative-admission-and-sampled-growth-abort');
      assert.ok(record.byteBudget.family <= 128 * 1024 * 1024); assert.equal(record.inputs.length, 2);
      for (const input of record.inputs) assert.match(input.sha256, /^[a-f0-9]{64}$/u);
      assert.ok(Object.values(record.environmentValueHashes).every(value => /^[a-f0-9]{64}$/u.test(value)));
    }
    assert.equal(launches, ['forged-capability', 'revoked-trust', 'boundary-forged', 'boundary-dual-runner'].includes(selected) ? 0 : 1);
  }
  passed = true;
} finally {
  fs.open = open; fs.unlink = unlink; ready = true; injectWrite = false; injectRelease = false;
  if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
}
console.log(`Scoped CDB fixture-controlled IO: ${selected}`);
