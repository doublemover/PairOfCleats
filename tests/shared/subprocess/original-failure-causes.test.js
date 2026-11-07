import assert from 'node:assert/strict';
import { once } from 'node:events';
import { registerHooks } from 'node:module';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { SubprocessError, SubprocessAbortError } from '../../../src/shared/subprocess/errors.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('shared/subprocess/original-failure-causes/')[1];
assert.ok(['constructor-presence', 'spawn-callback', 'stdout-callback', 'stderr-callback', 'stdout-byte-callback', 'stderr-byte-callback', 'stdin-error', 'pre-abort-reasons', 'owned-abort-reasons', 'tree-cleanup-rejections'].includes(mode));
const originals = [false, 0, '', null, undefined];
if (mode === 'constructor-presence') {
  const result = Object.freeze({ exitCode: 7 });
  for (const Constructor of [SubprocessError, SubprocessAbortError]) {
    assert.equal(Object.hasOwn(new Constructor('original message', result), 'cause'), false, 'absent cause must stay absent');
    for (const original of [...originals, Object.freeze(new Error('original object'))]) {
      const error = new Constructor('original message', result, original);
      assert.equal(Object.hasOwn(error, 'cause'), true); assert.equal(error.cause, original);
      assert.equal(Object.prototype.propertyIsEnumerable.call(error, 'cause'), true, 'existing subprocess cause projection remains enumerable');
      assert.equal(error.result, result); assert.equal(error.message, 'original message');
      assert.equal(error.code, Constructor === SubprocessError ? 'SUBPROCESS_FAILED' : 'ABORT_ERR');
    }
  }
} else if (mode === 'pre-abort-reasons') {
  for (const original of originals.slice(0, -1)) {
    const controller = new AbortController(); controller.abort(original);
    const error = await spawnSubprocess(process.execPath, ['-e', 'throw new Error("must not launch")'], {
      signal: controller.signal, onSpawn() { assert.fail('Pre-aborted request launched'); }, stdio: 'ignore'
    }).catch(error => error);
    assert.equal(error.code, 'ABORT_ERR'); assert.equal(error.cause, original); assert.equal(error.result.pid, null);
    assert.equal(getTrackedSubprocessCount(), 0);
  }
  const inspection = new Error('original reason getter failure');
  const signal = { aborted: true, addEventListener() {}, removeEventListener() {}, get reason() { throw inspection; } };
  const error = await spawnSubprocess(process.execPath, [], { signal, stdio: 'ignore' }).catch(error => error);
  assert.equal(error.code, 'ABORT_ERR'); assert.equal(error.cause, inspection);
} else if (mode === 'tree-cleanup-rejections') {
  const runner = new URL('../../../src/shared/subprocess/runner-async.js', import.meta.url).href;
  const tree = new URL('../../../src/shared/kill-tree.js', import.meta.url).href;
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '../kill-tree.js' && context.parentURL?.split('?')[0] === runner) return { url: 'original-tree-failure:owner', shortCircuit: true };
    return next(specifier, context);
  }, load(url, context, next) {
    if (url !== 'original-tree-failure:owner') return next(url, context);
    return { format: 'module', shortCircuit: true, source: `export * from ${JSON.stringify(tree)};
      export const killChildProcessTree = async child => {
        const fixture=globalThis.originalTreeFailureFixture;
        if(child!==fixture.child) throw new Error('Unexpected owned child');
        fixture.calls++; const closed=new Promise(resolve=>child.once('close',resolve)); child.kill(); await closed;
        throw fixture.error;
      };` };
  } });
  try {
    const { spawnSubprocess: freshSpawn } = await import(runner + '?original-tree-rejections');
    for (const original of originals) {
      const fixture = { child: null, error: original, calls: 0 }; globalThis.originalTreeFailureFixture = fixture;
      const controller = new AbortController(); let closed = false;
      try {
        const error = await freshSpawn(process.execPath, ['-e', 'setInterval(()=>{},1000);'], {
          stdio: 'ignore', signal: controller.signal, killTree: false, timeoutMs: 5000, timeoutAbortReapWaitMs: 500,
          onSpawn: child => { fixture.child = child; child.once('close', () => { closed = true; }); controller.abort('original abort'); }
        }).then(() => assert.fail('Expected original cleanup failure'), error => error);
        assert.equal(closed, true); assert.equal(fixture.calls, 1); assert.equal(error.code, 'ABORT_ERR');
        assert.equal(error.result.termination.treeCleanupSettled, true); assert.equal(error.result.termination.treeCleanupFailed, true);
        assert.ok(error instanceof SubprocessAbortError, 'tree failure preserves the original subprocess error contract');
        assert.equal(error.treeCleanupError, original); assert.equal(errorGraphIncludes(error, original), true);
        assert.deepEqual(error.errors, [original]); assert.equal(Object.isFrozen(error.errors), true);
        assert.equal(errorGraphIncludes(error, 'original abort'), true, 'independent primary and cleanup causes both survive');
        assert.equal(error.cacheOwnershipPending, true); assert.equal(error.cacheOwnershipReleased(), false);
        error.result.termination.treeCleanupFailed = false;
        assert.equal(error.cacheOwnershipReleased(), false, 'editing an audit cannot erase the original rejected tree attempt');
        assert.equal(getTrackedSubprocessCount(), 0, 'actual direct-child tracking retired independently');
      } finally {
        if (fixture.child && !closed) { const closure = once(fixture.child, 'close'); fixture.child.kill(); await closure; }
      }
    }
  } finally { hook.deregister(); delete globalThis.originalTreeFailureFixture; }
} else {
  for (const original of originals) {
    let child, closed = false;
    const controller = new AbortController();
    const stdout = ['stdout-callback', 'stdout-byte-callback'].includes(mode), stderr = ['stderr-callback', 'stderr-byte-callback'].includes(mode);
    const script = (stdout ? 'process.stdout.write("original output");' : stderr ? 'process.stderr.write("original error");' : '')
      + 'setInterval(() => {},1000);';
    const options = { stdio: ['pipe', stdout ? 'pipe' : 'ignore', stderr ? 'pipe' : 'ignore'], killTree: false,
      timeoutMs: 5000, timeoutAbortReapWaitMs: 500, killGraceMs: 0, maxOutputBytes: 64,
      onSpawn: actual => {
        child = actual; child.once('close', () => { closed = true; });
        if (mode === 'spawn-callback') throw original;
        if (mode === 'stdin-error') child.stdin.emit('error', original);
        if (mode === 'owned-abort-reasons') controller.abort(original);
      }, ...(stdout ? { [mode === 'stdout-byte-callback' ? 'onStdoutChunk' : 'onStdout']() { throw original; } } : {}),
      ...(stderr ? { [mode === 'stderr-byte-callback' ? 'onStderrChunk' : 'onStderr']() { throw original; } } : {}),
      ...(mode === 'owned-abort-reasons' ? { signal: controller.signal } : {}) };
    try {
      const error = await spawnSubprocess(process.execPath, ['-e', script], options)
        .then(() => assert.fail('Expected original operation failure'), error => error);
      assert.equal(error.code, mode === 'owned-abort-reasons' ? 'ABORT_ERR' : 'SUBPROCESS_FAILED');
      assert.equal(Object.hasOwn(error, 'cause'), true);
      assert.equal(error.cause, mode === 'owned-abort-reasons' ? controller.signal.reason : original);
      assert.equal(closed, true, 'a projected failure does not replace actual child retirement');
      assert.equal(error.result.termination.closeObserved, true); assert.equal(error.result.termination.closeTimedOut, false);
      assert.equal(getTrackedSubprocessCount(), 0);
    } finally {
      if (child && !closed) { const closure = once(child, 'close'); child.kill(); await closure; }
    }
  }
}
console.log('Subprocesses preserve explicit falsy causes and actual abort reasons without weakening child retirement');
