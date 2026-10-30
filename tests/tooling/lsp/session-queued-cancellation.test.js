import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { registerHooks } from 'node:module';

const clients = [], creationOptions = [];
let createGate = null, createStarted = null, shutdownGate = null, shutdownStarted = null;
globalThis.__queuedLspClientFactory = async options => {
  creationOptions.push(options); createStarted?.resolve();
  if (createGate) await createGate.promise;
  const client = { kills: 0, stopped: false,
    isTransportRunning: () => !client.stopped, getGeneration: () => 1,
    shutdownAndExit: async () => { shutdownStarted?.resolve(); if (shutdownGate) await shutdownGate.promise; },
    kill: async () => { client.kills++; client.stopped = true; return { exitObserved: true }; },
    killSync: () => { client.stopped = true; },
    getTerminationEvidence: () => ({ settled: client.stopped, exitObserved: client.stopped }) };
  clients.push(client); return client;
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/lsp/managed-client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createRetainedLspClient = options => globalThis.__queuedLspClientFactory(options);' };
  return next(url, context);
} });
const until = async predicate => {
  for (let turn = 0; turn < 100 && !predicate(); turn++) await Promise.resolve();
  assert.ok(predicate(), 'controlled admission boundary must be reached without wall-clock sleeps');
};
try {
  const { withLspSession, drainLspSessionPool, __testLspSessionPool: pool } =
    await import('../../../src/integrations/tooling/providers/lsp/session-pool.js');
  const options = { enabled: true, repoRoot: process.cwd(), cmd: 'authored-queue',
    timeoutMs: 1000, retries: 0, breakerThreshold: 10, sessionIdleTimeoutMs: 60000 };
  try {
    const held = Promise.withResolvers(), entered = Promise.withResolvers(), order = [];
    let firstClient;
    const first = withLspSession(options, async lease => {
      firstClient = lease.client; lease.markInitialized({ capabilities: {} });
      order.push('A'); entered.resolve(); await held.promise;
    });
    await entered.promise;
    const controller = new AbortController();
    const second = withLspSession({ ...options, abortSignal: controller.signal }, async () => { order.push('B'); });
    const secondRejected = assert.rejects(second, { name: 'AbortError' });
    const third = withLspSession(options, async lease => {
      order.push('C'); assert.equal(lease.client, firstClient); assert.equal(lease.shouldInitialize, false);
    });
    await until(() => pool.getMetrics().leaseQueueWaiters === 2);
    controller.abort(); await secondRejected;
    assert.deepEqual(order, ['A']); assert.equal(firstClient.kills, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    held.resolve(); await Promise.all([first, third]);
    assert.deepEqual(order, ['A', 'C']); assert.equal(clients.length, 1);
    assert.equal(pool.getMetrics().admissionCancelled, 1);
    assert.equal(pool.getMetrics().admissionWaiters, 0); assert.equal(pool.getMetrics().leaseQueueWaiters, 0);
    await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });

    // A caller can leave during owned asynchronous creation; the creation owner
    // still publishes one healthy session for C, never B's abandoned handlers.
    createGate = Promise.withResolvers(); createStarted = Promise.withResolvers();
    const cancelledCreator = new AbortController(), cancelledPeer = new AbortController();
    let abandonedCalls = 0;
    const creating = withLspSession({ ...options, abortSignal: cancelledCreator.signal,
      onNotification: () => { abandonedCalls++; } }, async () => { abandonedCalls++; });
    const creatorRejected = assert.rejects(creating, { name: 'AbortError' });
    await createStarted.promise;
    const peer = withLspSession({ ...options, abortSignal: cancelledPeer.signal }, async () => { abandonedCalls++; });
    const peerRejected = assert.rejects(peer, { name: 'AbortError' });
    let admitted = false;
    const successor = withLspSession(options, async () => { admitted = true; });
    cancelledCreator.abort(); cancelledPeer.abort(); await Promise.all([creatorRejected, peerRejected]);
    assert.equal(admitted, false); assert.equal(clients.length, 1);
    const ownedCreation = creationOptions.at(-1);
    assert.equal(ownedCreation.abortSignal, undefined);
    assert.equal(typeof ownedCreation.onNotification, 'function', 'the session owns its stable notification dispatcher');
    assert.equal(typeof ownedCreation.onRequest, 'function', 'the session owns its stable request dispatcher');
    ownedCreation.onNotification({ method: 'fixture/notification' });
    assert.equal(await ownedCreation.onRequest({ method: 'fixture/request' }), null);
    assert.equal(abandonedCalls, 0, 'owned dispatchers never retain the cancelled borrower handlers');
    createGate.resolve(); await successor; createGate = null; createStarted = null;
    assert.equal(abandonedCalls, 0); assert.equal(clients.length, 2);
    assert.equal(getEventListeners(cancelledCreator.signal, 'abort').length, 0);
    assert.equal(getEventListeners(cancelledPeer.signal, 'abort').length, 0);

    shutdownGate = Promise.withResolvers(); shutdownStarted = Promise.withResolvers();
    const disposal = drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
    await shutdownStarted.promise;
    const waiting = new AbortController();
    const blocked = withLspSession({ ...options, abortSignal: waiting.signal }, async () => { abandonedCalls++; });
    const blockedRejected = assert.rejects(blocked, { name: 'AbortError' });
    let afterDisposal = false;
    const replacement = withLspSession(options, async () => { afterDisposal = true; });
    waiting.abort(); await blockedRejected;
    assert.equal(afterDisposal, false); assert.equal(clients.length, 2);
    assert.equal(pool.getPendingDisposals(), 1); assert.equal(getEventListeners(waiting.signal, 'abort').length, 0);
    shutdownGate.resolve(); assert.equal((await disposal).status, 'ok'); await replacement;
    shutdownGate = null; shutdownStarted = null;
    assert.equal(clients.length, 3); assert.equal(abandonedCalls, 0);
    assert.equal(pool.getMetrics().admissionWaiters, 0);
  } finally {
    createGate?.resolve(); shutdownGate?.resolve(); createGate = null; shutdownGate = null;
    await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
  }
} finally { hook.deregister(); delete globalThis.__queuedLspClientFactory; }
console.log('Queued LSP cancellation preserves predecessor order, shared creation/disposal ownership and healthy-session reuse.');
