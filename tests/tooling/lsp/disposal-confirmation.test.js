import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
let outcome = 'unconfirmed', creations = 0;
globalThis.__lspDisposalFactory = () => {
  creations++;
  return { isTransportRunning: () => true, getGeneration: () => 1,
    shutdownAndExit: async () => {}, killSync() {},
    kill: async () => {
      if (outcome === 'rejected') throw new Error('controlled termination denied');
      return { exitObserved: outcome === 'confirmed', terminated: outcome === 'confirmed' };
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
  const failed = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.rejected, 1);
  assert.ok(__testLspSessionPool.getPendingDisposals() > 0);
  await assert.rejects(withLspSession(options, async () => {}), { code: 'ERR_LSP_DISPOSAL_UNCONFIRMED' });
  assert.equal(creations, 1, 'same-key replacement cannot pass an unconfirmed teardown');
  outcome = 'rejected';
  const denied = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
  assert.equal(denied.status, 'failed'); assert.equal(denied.rejected, 1);
  assert.equal(__testLspSessionPool.getMetrics().disposalFailures, 1, 'one failed owner has once-only failure accounting');
  outcome = 'confirmed';
  const complete = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
  assert.equal(complete.status, 'ok'); assert.equal(complete.rejected, 0);
  await withLspSession(options, async () => {});
  assert.equal(creations, 2);
  await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
} finally { hook.deregister(); delete globalThis.__lspDisposalFactory; }
console.log('LSP disposal confirmation and replacement barrier passed');
