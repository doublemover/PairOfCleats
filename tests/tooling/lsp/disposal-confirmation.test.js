import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
let outcome = 'unconfirmed', creations = 0;
globalThis.__lspDisposalFactory = () => {
  creations++;
  let settled = false;
  const observers = new Set();
  const evidence = () => ({ settled, closeObserved: settled, exitObserved: settled, pending: !settled });
  return { isTransportRunning: () => !settled, getGeneration: () => 1,
    onResourcesSettled: observer => { observers.add(observer); return () => observers.delete(observer); },
    getTerminationEvidence: evidence, waitForResourceSettlement: async () => evidence(),
    shutdownAndExit: async () => {}, killSync() {},
    kill: async () => {
      if (outcome === 'rejected') throw new Error('controlled termination denied');
      settled = outcome === 'confirmed';
      if (settled) for (const observer of observers) observer();
      return { ...evidence(), terminated: settled };
    } };
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/lsp/client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createLspClient = () => globalThis.__lspDisposalFactory();' };
  return next(url, context);
} });
try {
  const { withLspSession, drainLspSessionPool, __testLspSessionPool } = await import('../../../src/integrations/tooling/providers/lsp/session-pool.js');
  const options = { repoRoot: process.cwd(), cmd: 'authored', enabled: true, log: () => {},
    timeoutMs: 1000, retries: 0, breakerThreshold: 10, sessionIdleTimeoutMs: 10000 };
  await withLspSession(options, async () => {});
  const diagnosticFailure = new Error('controlled drain logger failure');
  const failed = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log: () => { throw diagnosticFailure; } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.rejected, 1);
  assert.ok(__testLspSessionPool.getPendingDisposals() > 0);
  await assert.rejects(withLspSession(options, async () => {}), { code: 'ERR_LSP_DISPOSAL_UNCONFIRMED' });
  assert.equal(creations, 1, 'same-key replacement cannot pass an unconfirmed teardown');
  outcome = 'rejected';
  const denied = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log: () => { throw diagnosticFailure; } });
  assert.equal(denied.status, 'failed'); assert.equal(denied.rejected, 1);
  assert.equal(__testLspSessionPool.getMetrics().disposalFailures, 1, 'one failed owner has once-only failure accounting');
  outcome = 'confirmed';
  const complete = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false, log: () => { throw diagnosticFailure; } });
  assert.equal(complete.status, 'ok'); assert.equal(complete.rejected, 0);
  await withLspSession(options, async () => {});
  assert.equal(creations, 2);
  await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
} finally { hook.deregister(); delete globalThis.__lspDisposalFactory; }
console.log('LSP disposal confirmation and replacement barrier passed');
