import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/lsp/drain-lifetime-matrix/')[1];
assert.ok(['kill-timeout', 'graceful-timeout-force', 'delayed-close', 'real-server-exit'].includes(selected));
let creations = 0, kills = 0, syncKills = 0, shutdowns = 0, settled = false, phase = selected;
let resolveKill, resolveClose, resolveShutdown, activeConfirm = () => {};
const evidence = () => ({ settled, closeObserved: settled, exitObserved: settled, pending: !settled });
const confirm = () => activeConfirm();
globalThis.__drainLifetimeFactory = () => {
  creations++; settled = false;
  let closed = false; const observers = new Set();
  const ownedEvidence = () => ({ settled: closed, closeObserved: closed, exitObserved: closed, pending: !closed });
  const ownedConfirm = () => { closed = true; settled = true; for (const observer of observers) observer(); resolveClose?.(ownedEvidence()); };
  activeConfirm = ownedConfirm;
  return { isTransportRunning: () => !closed, getGeneration: () => 1, getTerminationEvidence: ownedEvidence,
    onResourcesSettled: observer => { observers.add(observer); return () => observers.delete(observer); },
    shutdownAndExit() { shutdowns++; return phase === 'graceful-timeout-force' ? new Promise(resolve => { resolveShutdown = resolve; }) : Promise.resolve(); },
    waitForResourceSettlement: () => phase === 'delayed-close' && !closed ? new Promise(resolve => { resolveClose = resolve; }) : Promise.resolve(ownedEvidence()),
    killSync() { syncKills++; return { terminated: false, exitObserved: false }; },
    kill() {
      kills++;
      if (phase === 'kill-timeout') return new Promise(resolve => { resolveKill = resolve; });
      if (phase === 'delayed-close') return Promise.resolve({ terminated: true, exitObserved: true, settled: false });
      if (phase === 'unconfirmed') return Promise.resolve({ terminated: false, exitObserved: false });
      ownedConfirm(); resolveShutdown?.(); return Promise.resolve(ownedEvidence());
    } };
};
let hook;
if (selected !== 'real-server-exit') hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/lsp/client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createLspClient = () => globalThis.__drainLifetimeFactory();' };
  return next(url, context);
} });
const { withLspSession, drainLspSessionPool, __testLspSessionPool } = await import('../../../src/integrations/tooling/providers/lsp/session-pool.js');
const logFailure = new Error('controlled diagnostic callback'), log = () => { throw logFailure; };
const options = { repoRoot: process.cwd(), cmd: 'authored', enabled: true, log: () => {}, timeoutMs: 1000,
  retries: 0, breakerThreshold: 10, sessionIdleTimeoutMs: 60000 };
try {
  if (selected === 'real-server-exit') {
    let originalClient;
    await withLspSession({ ...options, cmd: process.execPath,
      args: [path.resolve('tests/fixtures/lsp/stub-lsp-server.js'), '--mode', 'clangd', '--exit-on-shutdown'] }, async ({ client }) => {
      originalClient = client; await client.initialize({ rootUri: pathToFileURL(process.cwd()).href, timeoutMs: 2000 });
    });
    const receipt = await drainLspSessionPool({ timeoutMs: 5000, killFirst: false, log });
    assert.equal(receipt.status, 'ok'); assert.equal(receipt.rejected, 0);
    assert.equal(originalClient.getTerminationEvidence().settled, true);
    assert.equal((await drainLspSessionPool({ timeoutMs: 1000, log })).status, 'ok');
  } else {
    await withLspSession(options, async () => {});
    if (selected === 'graceful-timeout-force') {
      const receipt = await drainLspSessionPool({ timeoutMs: 12000, killFirst: false, log });
      assert.equal(receipt.status, 'ok'); assert.equal(kills, 1); assert.equal(shutdowns, 1); assert.equal(settled, true);
    } else {
      const receipt = await drainLspSessionPool({ timeoutMs: 100, killFirst: false, log });
      assert.equal(receipt.status, 'timed_out'); assert.equal(settled, false); assert.ok(syncKills > 0);
      assert.ok(__testLspSessionPool.getPendingDisposals() > 0);
      const cancellation = new AbortController();
      const blocked = withLspSession({ ...options, abortSignal: cancellation.signal }, async () => assert.fail('pending owner cannot be replaced'));
      cancellation.abort(); await assert.rejects(blocked, { name: 'AbortError' }); assert.equal(creations, 1);
      if (selected === 'kill-timeout') {
        phase = 'unconfirmed'; resolveKill({ terminated: false, exitObserved: false });
        const failed = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log });
        assert.equal(failed.status, 'failed'); assert.equal(__testLspSessionPool.getMetrics().disposalFailures, 1);
        phase = 'confirmed'; confirm();
      } else { confirm(); phase = 'confirmed'; }
      assert.equal((await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log })).status, 'ok');
      assert.equal((await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log })).status, 'ok');
      await withLspSession(options, async () => {}); assert.equal(creations, 2);
      await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log });
    }
  }
  assert.equal(__testLspSessionPool.getSize(), 0); assert.equal(__testLspSessionPool.getPendingDisposals(), 0);
} finally { phase = 'confirmed'; confirm(); resolveKill?.(evidence()); resolveShutdown?.();
  await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log: () => {} }); hook?.deregister(); delete globalThis.__drainLifetimeFactory; }
console.log('LSP drain lifetime ' + selected + ' preserves observed closure, barriers and primary outcomes despite throwing diagnostics.');
