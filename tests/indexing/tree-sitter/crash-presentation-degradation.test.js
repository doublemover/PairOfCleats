import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSchedulerCrashTracker } from '../../../src/index/build/tree-sitter-scheduler/runner/crash-tracker.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

// Actual diagnostic admission and tiny atomic publishers, no parser or child.
// Authored only; execution and Windows qualification are deferred.
const { dir } = await prepareIsolatedTestCacheDir('crash-presentation-degradation');
const unhandled = [], onUnhandled = error => unhandled.push(error);
process.on('unhandledRejection', onUnhandled);
try {
  for (const mode of ['synchronous', 'rejected', 'enabled-getter', 'external-getter', 'healthy']) {
    const baseDir = path.join(dir, mode, 'local'), repoCacheRoot = path.join(dir, mode, 'repo');
    await fs.mkdir(baseDir, { recursive: true });
    const external = [], presented = [], errors = [];
    const logError = Object.freeze(Object.assign(new Error('frozen presentation failure'), { code: 'ELOG' }));
    const primary = Object.freeze(Object.assign(new Error('original parser failure'), {
      result: Object.freeze({ exitCode: 7, stderr: 'original diagnostic' })
    }));
    const logger = {
      enabled: true,
      async persistForensicBundle(bundle) { assert.equal(this, logger); external.push(bundle); },
      logError(error) {
        assert.equal(this, logger); errors.push(error);
        if (mode === 'synchronous') throw logError;
        if (mode === 'rejected') return Promise.reject(logError);
      }
    };
    if (mode === 'enabled-getter') Object.defineProperty(logger, 'enabled', { get() { throw logError; } });
    if (mode === 'external-getter') Object.defineProperty(logger, 'persistForensicBundle', { get() { throw logError; } });
    const tracker = createSchedulerCrashTracker({ runtime: { repoCacheRoot, buildId: mode },
      outDir: path.join(dir, mode, 'index'), paths: { baseDir }, groupByGrammarKey: new Map(), crashLogger: logger,
      log(line) {
        presented.push(line);
        if (mode === 'synchronous') throw logError;
        if (mode === 'rejected') return Promise.reject(logError);
      } });
    await tracker.recordFailure({ grammarKey: 'fixture', error: primary });
    const receipt = await tracker.waitForPersistence();
    assert.equal(primary.result.stderr, 'original diagnostic');
    for (const [sink, filename] of [['local', tracker.getBundlePath()], ['durable', tracker.getDurableBundlePath()]]) {
      assert.ok(receipt.sinks.some(value => value.sink === sink && value.ok));
      const bundle = JSON.parse(await fs.readFile(filename, 'utf8'));
      assert.equal(bundle.events.length, 1);
      assert.equal(bundle.events[0].errorMessage, primary.message);
      assert.equal(bundle.degradation.schemaVersion, 1);
      assert.deepEqual(bundle.degradation.scopes, [{ scope: 'grammar', grammarKey: 'fixture', reason: 'failed-grammar' }]);
    }
    assert.equal(external.length, mode === 'external-getter' ? 0 : 1);
    assert.ok(presented.length > 0);
    if (mode === 'healthy') {
      assert.equal(receipt.ok, true);
      assert.deepEqual(receipt.failures, []);
      assert.equal(errors.length, 1);
    } else {
      assert.equal(receipt.ok, false);
      const expected = mode === 'external-getter' ? ['external']
        : mode === 'enabled-getter' ? ['error-log'] : ['presentation', 'error-log', 'warning', 'warning'];
      assert.deepEqual(receipt.failures.map(value => value.sink).sort(), expected.sort());
      assert.ok(receipt.failures.every(value => value.code === 'ELOG'));
      assert.equal(receipt.failures.some(value => value.sink === 'serialization'), false,
        'an external getter failure belongs to its own sink');
    }
    assert.deepEqual(tracker.summarize().persistence, receipt);
    assert.deepEqual(tracker.summarize().degradation.scopes,
      [{ scope: 'grammar', grammarKey: 'fixture', reason: 'failed-grammar' }]);
  }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(unhandled, [], 'rejected warning presentation cannot escape as unhandled work');
} finally {
  process.removeListener('unhandledRejection', onUnhandled);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log('Scheduler evidence survives fallible presentation; controls authored, execution deferred.');
