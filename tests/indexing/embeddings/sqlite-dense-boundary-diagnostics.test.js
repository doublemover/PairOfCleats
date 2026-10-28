import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { runSqliteDenseWithBoundary, resolveSqliteDenseCrashCapture } from '../../../tools/build/embeddings/sqlite-dense-isolate.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

// UNVALIDATED: explicit trusted fixture runner, zero subprocess/native launch.
// Simulated exit codes and metadata fixtures never qualify native dump capture.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['capture-disabled', 'capture-unavailable', 'capture-platform', 'native-failure', 'signed-native-failure',
  'null-exit', 'string-exit', 'invalid-json', 'empty-json', 'nonobject-json', 'truncated-json', 'child-pending',
  'child-replaced', 'child-observer-inspection', 'child-revoked-success', 'publisher-failure', 'publisher-null',
  'publisher-pending', 'warning-failure', 'warning-pending', 'launch-failure', 'testhook-untrusted',
  'required-forensic-write', 'required-forensic-index', 'optional-forensic-write', 'null-metadata', 'non-string-output'].includes(selected));
const { dir: root } = await prepareIsolatedTestCacheDir(`sqlite-boundary-diagnostics-${selected}`);
const repoCacheRoot = path.join(root, 'cache'); await fs.mkdir(repoCacheRoot);
let passed = false, ready = false, inspected = false, launches = 0, publishes = 0, warnings = 0, scans = 0, mkdirs = 0, failure, replay;
const primary = Object.freeze(Object.assign(new Error('original fixture publication/launch failure'), { code: 'EACCES' }));
const secondary = Object.freeze(Object.assign(new Error('independent child diagnostic owner'), { cacheOwnershipReleased: () => inspected }));
const pending = Object.freeze({ cacheOwnershipReleased: () => ready });
const original = { readdirSync: fsSync.readdirSync, mkdirSync: fsSync.mkdirSync };
const legacy = path.join(repoCacheRoot, 'logs', 'forensics', 'sqlite-stage3-dumps', 'fixture-code');
fsSync.readdirSync = (file, ...args) => { if (typeof file === 'string' && file.includes('sqlite-stage3-dumps')) scans++; return original.readdirSync(file, ...args); };
fsSync.mkdirSync = (file, ...args) => { if (typeof file === 'string' && file.includes('sqlite-stage3-dumps')) mkdirs++; return original.mkdirSync(file, ...args); };
try {
  if (selected.startsWith('capture-')) {
    const capture = resolveSqliteDenseCrashCapture({ requested: selected !== 'capture-disabled', platform: selected === 'capture-platform' ? 'linux' : 'win32' });
    assert.equal(capture.requested, selected !== 'capture-disabled'); assert.equal(capture.enabled, false);
    assert.equal(capture.status, selected === 'capture-disabled' ? 'disabled' : selected === 'capture-platform' ? 'unsupported-platform' : 'unavailable');
    assert.equal(capture.dumpDir, null); assert.deepEqual(capture.dumpFiles, []); assert.equal(scans, 0); assert.equal(mkdirs, 0);
  } else if (selected.includes('forensic-')) {
    const logger = await createCrashLogger({ repoCacheRoot, enabled: true });
    const open = fs.open, warn = console.warn;
    let injected = true, writes = 0;
    console.warn = (...args) => { warnings++; assert.ok(args.some(value => String(value).includes('forensic'))); };
    fs.open = async (file, flags, ...args) => {
      if (typeof file === 'string' && typeof flags === 'string' && /[wx]/u.test(flags)) {
        const target = selected === 'required-forensic-index' ? 'index-crash-forensics-index.json' : 'sqlite-stage3-replay-fixture.json';
        if (file.includes('sqlite-stage3-replay-fixture.json')) writes++;
        if (injected && file.includes(target)) throw primary;
      }
      return open(file, flags, ...args);
    };
    try {
      const request = { kind: 'sqlite-stage3-replay', signature: 'fixture', bundle: { stage: 'stage3', fixture: true }, required: selected !== 'optional-forensic-write' };
      if (request.required) await assert.rejects(logger.persistForensicBundle(request), error => errorGraphIncludes(error, primary));
      else assert.equal(await logger.persistForensicBundle(request), null);
      assert.equal(warnings, request.required ? 0 : 1);
      injected = false;
      const before = writes, persisted = await logger.persistForensicBundle({ ...request, required: true });
      assert.equal(typeof persisted, 'string'); assert.ok(writes > before, 'failed publication cannot leave a successful in-memory dedup receipt');
      const envelope = JSON.parse(await fs.readFile(persisted, 'utf8')); assert.equal(envelope.bundle.fixture, true);
      const index = JSON.parse(await fs.readFile(path.join(logger.paths.directory, 'index-crash-forensics-index.json'), 'utf8'));
      assert.equal(index.entries.some(item => item.path === persisted), true);
    } finally { fs.open = open; console.warn = warn; await logger.close(); }
  } else {
    const result = { exitCode: selected === 'signed-native-failure' ? -1073741819 : 3221225477,
      signal: null, durationMs: null, stdout: '', stderr: 'original native child diagnostic' };
    if (selected === 'null-exit') result.exitCode = null;
    if (selected === 'string-exit') result.exitCode = '0';
    if (['invalid-json', 'empty-json', 'nonobject-json', 'truncated-json', 'child-pending', 'child-replaced',
      'child-observer-inspection', 'child-revoked-success'].includes(selected)) { result.exitCode = 0; result.stdout = '{"skipped":false,"count":1}'; }
    if (selected === 'invalid-json') result.stdout = '{invalid';
    if (selected === 'empty-json') result.stdout = '';
    if (selected === 'nonobject-json') result.stdout = 'null';
    if (selected === 'truncated-json') result.outputCapture = { stdout: { truncated: true } };
    if (selected === 'non-string-output') {
      result.stdout = result.stderr = Object.freeze({ toString() { assert.fail('untrusted diagnostic values must not be coerced'); } });
    }
    if (selected.startsWith('child-')) Object.defineProperty(result, 'cacheOwnershipReleased', { configurable: true, value() {
      assert.equal(this, result); if (selected === 'child-observer-inspection' && !ready) throw secondary;
      return ready;
    } });
    if (selected === 'child-revoked-success') ready = true;
    const call = () => runSqliteDenseWithBoundary({ root, userConfig: {}, indexRoot: root, repoCacheRoot,
      mode: 'code', vectorsPath: path.join(root, 'vectors'), dbPath: path.join(root, 'index.db'),
      dims: selected === 'null-metadata' ? null : 3, scale: null, buildId: 'fixture', workerIdentity: 'fixture-worker',
      enableWindowsCrashCapture: true,
      testRunChild: async options => {
        launches++; assert.equal(options.rejectOnNonZeroExit, false); assert.equal(options.maxOutputBytes, 1024 * 1024);
        assert.equal(options.env.PAIROFCLEATS_SQLITE_DENSE_CHILD, '1');
        if (selected === 'launch-failure') throw primary;
        if (selected === 'native-failure') { await fs.mkdir(legacy, { recursive: true }); await fs.writeFile(path.join(legacy, 'unowned.dmp'), 'not a native dump'); }
        return result;
      },
      crashLogger: { async persistForensicBundle(input) {
        publishes++; replay = input.bundle; assert.equal(input.required, true);
        if (selected === 'publisher-failure') throw primary;
        if (selected === 'publisher-pending') return pending;
        if (selected === 'publisher-null') return null;
        return path.join(root, 'fixture-replay.json');
      } },
      logger: {
        log() { if (selected === 'child-revoked-success') ready = false; },
        warn() { warnings++; if (selected === 'warning-failure') throw primary; if (selected === 'warning-pending') return pending; }
      }
    });
    if (selected === 'testhook-untrusted') await withTemporaryEnv({ PAIROFCLEATS_TESTING: null }, async () => {
      await assert.rejects(call(), { code: 'ERR_SQLITE_DENSE_ISOLATE_INPUT' });
    });
    else await assert.rejects(call(), error => { failure = error; return true; });
    assert.equal(launches, selected === 'testhook-untrusted' ? 0 : 1);
    assert.equal(scans, 0); assert.equal(mkdirs, 0, 'an unavailable collector must not create placeholder dump directories');
    if (selected === 'launch-failure') assert.equal(failure, primary);
    else if (selected.startsWith('child-')) {
      assert.equal(errorGraphIncludes(failure, result), true); assert.equal(failure.cacheOwnershipReleased(), false);
      if (selected === 'child-replaced') Object.defineProperty(result, 'cacheOwnershipReleased', { value: () => true, configurable: true });
      assert.equal(failure.cacheOwnershipReleased(), false); ready = true;
      if (selected === 'child-observer-inspection') { assert.equal(failure.cacheOwnershipReleased(), false); inspected = true; }
      assert.equal(failure.cacheOwnershipReleased(), true); assert.equal(publishes, 0);
    } else if (['invalid-json', 'empty-json', 'nonobject-json', 'truncated-json'].includes(selected)) {
      assert.equal(failure.code, 'ERR_SQLITE_DENSE_ISOLATE_PARSE'); assert.equal(publishes, 0);
    } else if (selected !== 'testhook-untrusted') {
      assert.equal(failure.code, ['null-exit', 'string-exit'].includes(selected) ? 'ERR_SQLITE_STAGE3_SUBPROCESS_FAILED' : 'ERR_SQLITE_STAGE3_NATIVE_CRASH');
      assert.equal(failure.workerId, 'fixture-worker'); assert.equal(failure.result, result);
      assert.equal(failure.crashCapture.enabled, false); assert.equal(failure.dumpDir, null); assert.deepEqual(failure.dumpFiles, []);
      assert.equal(replay.schemaVersion, '1.1.0'); assert.equal(replay.crashCapture.requested, true); assert.equal(replay.crashCapture.enabled, false);
      assert.equal(replay.child.durationMs, null);
      if (['null-exit', 'string-exit'].includes(selected)) assert.equal(replay.child.exitCode, null);
      if (selected === 'null-metadata') { assert.equal(replay.replay.dims, null); assert.equal(replay.replay.scale, null); }
      if (selected === 'non-string-output') {
        assert.equal(replay.child.stdoutStatus, 'unavailable'); assert.equal(replay.child.stderrStatus, 'unavailable');
        assert.equal(replay.child.stdoutTail, ''); assert.equal(replay.child.stderrTail, '');
      }
      if (['publisher-failure', 'warning-failure'].includes(selected)) assert.equal(errorGraphIncludes(failure, primary), true);
      if (['publisher-pending', 'warning-pending'].includes(selected)) {
        assert.equal(errorGraphIncludes(failure, pending), true); assert.equal(failure.cacheOwnershipReleased(), false);
        ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
      }
      if (selected === 'publisher-null') assert.equal(failure.replayBundlePath, null);
      assert.equal(publishes, 1); assert.equal(warnings, 1);
    }
  }
  passed = true;
} finally {
  fsSync.readdirSync = original.readdirSync; fsSync.mkdirSync = original.mkdirSync; ready = true; inspected = true;
  if (passed) { assert.ok(root.startsWith(`${path.resolve('.tmp')}${path.sep}`)); await fs.rm(root, { recursive: true, force: true }); }
}
console.log(`SQLite native boundary diagnostics and capture capability: ${selected}`);
