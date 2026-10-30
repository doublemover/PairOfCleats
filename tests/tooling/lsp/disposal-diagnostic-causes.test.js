import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { setImmediate as turn } from 'node:timers/promises';
import { applyTestEnv } from '../../helpers/test-env.js';
import { addStorageFailureContext } from '../../../src/shared/storage/operation-error.js';
import { createAbortError } from '../../../src/shared/abort.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/lsp/disposal-diagnostic-causes/')[1];
assert.ok(['async-logger', 'hostile-cause', 'hard-kill-continuation', 'native-abort-classification'].includes(selected));
let phase = 'rejected', currentCause = Object.freeze(new Error('original controlled async kill denial'));
let fieldReads = 0, coercions = 0, proxyInspections = 0, creations = 0;
const warnings = [], unhandled = [], clients = [], hardKillCalls = [];
const onUnhandled = reason => unhandled.push(reason);
process.on('unhandledRejection', onUnhandled);
const inspectionFailure = Object.freeze(new Error('diagnostic getter must not run'));
const accessorCause = Object.freeze(Object.defineProperties(Object.create(null), {
  code: { get() { fieldReads++; throw inspectionFailure; } },
  message: { get() { fieldReads++; throw inspectionFailure; } },
  [Symbol.toPrimitive]: { value() { coercions++; throw inspectionFailure; } }
}));
const nonStringCause = Object.freeze({ code: { toString() { coercions++; throw inspectionFailure; } },
  message: { [Symbol.toPrimitive]() { coercions++; throw inspectionFailure; } },
  [Symbol.toPrimitive]() { coercions++; throw inspectionFailure; } });
const proxyCause = new Proxy(Object.create(null), { getOwnPropertyDescriptor() { proxyInspections++; throw inspectionFailure; },
  get() { fieldReads++; throw inspectionFailure; } });
const loggerFailure = Object.freeze(new Error('diagnostic promise rejection is not termination evidence'));
const log = message => {
  warnings.push(message);
  return selected === 'async-logger' ? Promise.reject(loggerFailure) : Promise.resolve();
};

globalThis.__lspDiagnosticCauseFactory = () => {
  const ordinal = creations++;
  let settled = false;
  const observers = new Set(), pendingKills = [];
  const evidence = () => ({ settled, closeObserved: settled, exitObserved: settled, pending: !settled });
  const confirm = () => {
    settled = true;
    for (const observer of observers) observer();
    for (const resolve of pendingKills.splice(0)) resolve(evidence());
  };
  const client = { ordinal, confirm, isTransportRunning: () => !settled, getGeneration: () => 1,
    onResourcesSettled: observer => { observers.add(observer); return () => observers.delete(observer); },
    getTerminationEvidence: evidence, waitForResourceSettlement: async () => evidence(), shutdownAndExit: async () => {},
    kill: async () => {
      if (phase === 'rejected') throw currentCause;
      if (phase === 'hard-wait') return new Promise(resolve => pendingKills.push(resolve));
      confirm(); return evidence();
    },
    killSync() {
      hardKillCalls.push(ordinal);
      if (phase === 'hard-wait') throw ordinal === 0 ? accessorCause : undefined;
      return { terminated: false, exitObserved: false };
    } };
  clients.push(client); return client;
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/lsp/client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createLspClient = () => globalThis.__lspDiagnosticCauseFactory();' };
  return next(url, context);
} });
let pool, failed = false, failure;
const retain = error => { failure = failed ? addStorageFailureContext(failure, {}, error, { secondaryPresent: true }) : error; failed = true; };
const options = { repoRoot: process.cwd(), cmd: 'authored-diagnostic-owner', enabled: true, log,
  timeoutMs: 1000, retries: 0, breakerThreshold: 10, sessionIdleTimeoutMs: 60000 };
try {
  pool = await import('../../../src/integrations/tooling/providers/lsp/session-pool.js');
  const { withLspSession, drainLspSessionPool, __testLspSessionPool } = pool;
  if (selected === 'native-abort-classification') {
    const nativeAbort = Object.freeze(new DOMException('original native cancellation', 'AbortError'));
    assert.equal(Object.hasOwn(nativeAbort, 'name'), false); assert.equal(Object.hasOwn(nativeAbort, 'code'), false);
    const shadowedAbort = new DOMException('original native cancellation with hostile diagnostic shadow', 'AbortError');
    Object.defineProperty(shadowedAbort, 'name', { get() { fieldReads++; throw inspectionFailure; } }); Object.freeze(shadowedAbort);
    for (const [cause, expectedDelta] of [[nativeAbort, 1], [Object.freeze(new DOMException('native non-abort', 'TimeoutError')), 0],
      [Object.freeze(createAbortError('original canonical cancellation')), 1], [shadowedAbort, 1],
      [Object.freeze(Object.create(DOMException.prototype)), 0]]) {
      phase = 'rejected'; currentCause = cause;
      await withLspSession(options, async () => {});
      const denied = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log });
      assert.equal(denied.status, 'failed'); assert.equal(denied.failures[0], cause);
      const before = __testLspSessionPool.getMetrics().admissionCancelled, beforeCreations = creations;
      let blocked = false;
      try { await withLspSession(options, async () => assert.fail('failed original owner cannot be replaced')); }
      catch (error) { blocked = true; assert.equal(error, cause); }
      assert.equal(blocked, true); assert.equal(creations, beforeCreations);
      assert.equal(__testLspSessionPool.getMetrics().admissionCancelled - before, expectedDelta,
        'Metric classification retains native/canonical abort identity without trusting forged prototypes or diagnostic getters.');
      phase = 'confirmed';
      assert.equal((await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log })).status, 'ok');
    }
  } else if (selected === 'hard-kill-continuation') {
    phase = 'hard-wait';
    await withLspSession({ ...options, workspaceKey: 'first' }, async () => {});
    await withLspSession({ ...options, workspaceKey: 'second' }, async () => {});
    assert.equal(creations, 2);
    const receipt = await drainLspSessionPool({ timeoutMs: 100, killFirst: false, log });
    assert.equal(receipt.status, 'timed_out'); assert.equal(receipt.timedOut, true);
    assert.equal(receipt.failures.length, 3);
    assert.equal(receipt.failures[0].code, 'LSP_SESSION_POOL_DRAIN_TIMEOUT');
    assert.equal(receipt.failures[1], accessorCause); assert.equal(receipt.failures[2], undefined);
    assert.deepEqual(hardKillCalls, [0, 1], 'A hostile first diagnostic cannot suppress the independent second original synchronous kill.');
    assert.ok(clients.every(client => client.getTerminationEvidence().settled === false));
    assert.equal(__testLspSessionPool.getPendingDisposals(), 2);
    const cancellation = new AbortController();
    const blocked = withLspSession({ ...options, workspaceKey: 'first', abortSignal: cancellation.signal },
      async () => assert.fail('unconfirmed first owner must not be replaced'));
    cancellation.abort(); await assert.rejects(blocked, { name: 'AbortError' }); assert.equal(creations, 2);
    phase = 'confirmed'; for (const client of clients) client.confirm();
    assert.equal((await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log })).status, 'ok');
    await withLspSession({ ...options, workspaceKey: 'first' }, async () => {}); assert.equal(creations, 3);
  } else {
    const causes = selected === 'async-logger' ? [currentCause, undefined]
      : [accessorCause, nonStringCause, proxyCause, Object.freeze(new Error('bounded diagnostic '.repeat(1000)))];
    for (const [index, cause] of causes.entries()) {
      phase = 'rejected'; currentCause = cause;
      const before = creations;
      await withLspSession(options, async () => {}); assert.equal(creations, before + 1);
      const receipt = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log });
      assert.equal(receipt.status, 'failed'); assert.equal(receipt.rejected, 1);
      assert.equal(receipt.failures.length, 1); assert.equal(receipt.failures[0], cause);
      assert.equal(__testLspSessionPool.getPendingDisposals(), 1);
      let blocked = false;
      try { await withLspSession(options, async () => assert.fail('failed original disposal cannot authorize a replacement')); }
      catch (error) { blocked = true; assert.equal(error, cause); }
      assert.equal(blocked, true); assert.equal(creations, before + 1);
      assert.equal(__testLspSessionPool.getMetrics().disposalFailures, index + 1, 'Once-only failure accounting stays with each actual owner.');
      await turn(); await turn(); assert.deepEqual(unhandled, [], 'Returned logger rejections must be observed without replacing native failures.');
      phase = 'confirmed';
      const complete = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log });
      assert.equal(complete.status, 'ok'); assert.deepEqual(complete.failures, []);
      assert.equal(__testLspSessionPool.getPendingDisposals(), 0);
    }
    if (selected === 'async-logger') {
      await withLspSession(options, async () => {});
      const pending = new Promise(() => {}); let diagnosticCalls = 0;
      const complete = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false,
        log: () => { diagnosticCalls++; return pending; } });
      assert.equal(complete.status, 'ok'); assert.equal(diagnosticCalls, 1,
        'A logger promise is observed, never serialized into the native drain barrier.');
    } else assert.ok(proxyInspections > 0, 'The descriptor trap negative traverses the real warning projection.');
  }
  phase = 'confirmed'; for (const client of clients) client.confirm();
  const complete = await pool.drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log });
  assert.equal(complete.status, 'ok'); assert.equal(pool.__testLspSessionPool.getSize(), 0);
  assert.equal(pool.__testLspSessionPool.getPendingDisposals(), 0);
  assert.equal(fieldReads, 0, 'Diagnostic property getters never execute.');
  assert.equal(coercions, 0, 'Diagnostic objects are never coerced to strings.');
  assert.ok(warnings.length > 0); assert.ok(warnings.every(message => typeof message === 'string' && message.length <= 1024));
  await turn(); await turn(); assert.deepEqual(unhandled, []);
} catch (error) { retain(error); }
finally {
  phase = 'confirmed'; for (const client of clients) client.confirm();
  try { await pool?.drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log: () => {} }); }
  catch (error) { retain(error); }
  hook.deregister(); delete globalThis.__lspDiagnosticCauseFactory;
  await turn(); await turn(); process.off('unhandledRejection', onUnhandled);
  if (unhandled.length) retain(new AggregateError(unhandled, 'Unexpected unhandled diagnostic rejection.'));
}
if (failed) throw failure;
console.log('LSP public drain ' + selected + ' preserves original causes and independent termination attempts.');
