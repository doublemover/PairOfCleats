import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { buildVfsConsumerGeneration } from '../../../src/integrations/tooling/providers/lsp/materialization-generation.js';
import { ensureVfsDiskDocument } from '../../../src/index/tooling/vfs/disk.js';

// UNVALIDATED: actual pool/materializer, inert original client/termination owner.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['digest', 'edited', 'queued', 'queued-distinct', 'cancelled-epoch', 'cancelled-creation', 'unconfirmed', 'different-root', 'invalid'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'vfs-epoch-'));
const doc = value => ({ virtualPath: 'source.js', docHash: 'untrusted-identical-label', text: `const value = ${value};\n` });
const generation = (value, base = root) => buildVfsConsumerGeneration({ rootDir: base, docs: [doc(value)] });
const clients = [], logs = [], order = [];
let canExit = true, creationGate, creationStarted, held;
globalThis.__vfsEpochClient = async () => {
  creationStarted?.resolve(); if (creationGate) await creationGate.promise;
  const client = { settled: false, kills: 0, getGeneration: () => 1,
    isTransportRunning: () => !client.settled,
    getTerminationEvidence: () => ({ settled: client.settled, exitObserved: client.settled }),
    shutdownAndExit: async () => {}, killSync() {},
    async kill() { client.kills++; if (canExit) client.settled = true; return { exitObserved: client.settled }; } };
  clients.push(client); return client;
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/lsp/managed-client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createRetainedLspClient = () => globalThis.__vfsEpochClient();' };
  return next(url, context);
} });
const { withLspSession, drainLspSessionPool, __testLspSessionPool: pool } = await import('../../../src/integrations/tooling/providers/lsp/session-pool.js');
const options = { enabled: true, repoRoot: root, cmd: 'inert-epoch-client', timeoutMs: 1000, retries: 0,
  breakerThreshold: 10, sessionIdleTimeoutMs: 10000, log: message => logs.push(message) };
const run = (value, { base = root, ...extra } = {}, work = null) => withLspSession({ ...options,
  materializationGeneration: generation(value, base), ...extra }, async lease => {
  order.push(value);
  const result = await ensureVfsDiskDocument({ ...doc(value), baseDir: base, materializationSession: lease.materializationSession });
  assert.equal(await fs.readFile(result.path, 'utf8'), doc(value).text);
  await work?.(lease, result); return lease.client;
});
const settle = async () => { for (let turn = 0; turn < 100; turn++) await Promise.resolve(); };
try {
  if (selected === 'digest') {
    const a = doc(1), b = { ...doc(2), virtualPath: 'other.js' };
    const digest = docs => buildVfsConsumerGeneration({ rootDir: root, docs });
    assert.equal(digest([a, b]), digest([b, a])); assert.notEqual(generation(1), generation(2), 'actual bytes override a shared claimed hash');
    assert.notEqual(generation(1), generation(1, path.join(root, 'other-root')));
    assert.notEqual(digest([a]), digest([{ ...a, docHash: 'different-label' }]));
    assert.equal(digest([{ virtualPath: 'empty.js' }]), digest([{ virtualPath: 'empty.js', text: '' }]));
    assert.throws(() => digest([{ ...a, text: { toString() { assert.fail('no source coercion'); } } }]), TypeError);
  } else if (selected === 'invalid') {
    await assert.rejects(withLspSession({ ...options, materializationGeneration: 'not-a-digest' }, () => assert.fail('invalid generation cannot enter')), TypeError);
    assert.equal(clients.length, 0);
  } else if (selected === 'cancelled-creation') {
    creationGate = Promise.withResolvers(); creationStarted = Promise.withResolvers();
    const controller = new AbortController();
    const first = run(1, { abortSignal: controller.signal }); const cancelled = assert.rejects(first, { name: 'AbortError' });
    await creationStarted.promise;
    const successor = run(2); controller.abort(); await cancelled;
    creationGate.resolve(); await successor; creationGate = null;
    assert.deepEqual(order, [2]); assert.equal(clients.length, 2);
  } else if (['queued', 'queued-distinct', 'cancelled-epoch'].includes(selected)) {
    held = Promise.withResolvers(); const entered = Promise.withResolvers();
    const first = run(1, {}, async () => { entered.resolve(); await held.promise; }); await entered.promise;
    const controller = new AbortController();
    const second = run(2, selected === 'cancelled-epoch' ? { abortSignal: controller.signal } : {});
    const cancelled = selected === 'cancelled-epoch' ? assert.rejects(second, { name: 'AbortError' }) : null;
    const third = run(selected === 'queued' ? 2 : 3);
    await settle(); assert.deepEqual(order, [1]); assert.equal(clients.length, 1); assert.equal(clients[0].kills, 0);
    if (cancelled) { controller.abort(); await cancelled; }
    held.resolve(); await first; if (!cancelled) await second; await third;
    assert.deepEqual(order, selected === 'queued' ? [1, 2, 2] : cancelled ? [1, 3] : [1, 2, 3]);
    assert.equal(clients.length, selected === 'queued-distinct' ? 3 : 2);
  } else {
    const first = await run(1); assert.equal(await run(1), first); assert.equal(clients.length, 1);
    if (selected === 'unconfirmed') {
      canExit = false;
      await assert.rejects(run(2), { code: 'ERR_LSP_DISPOSAL_UNCONFIRMED' });
      const kills = first.kills;
      await assert.rejects(run(2), { code: 'ERR_LSP_DISPOSAL_UNCONFIRMED' });
      assert.equal(first.kills, kills, 'a rejected turnover is not automatically retried');
      assert.equal(clients.length, 1); assert.deepEqual(order, [1, 1]);
      assert.equal(await fs.readFile(path.join(root, 'source.js'), 'utf8'), doc(1).text);
      assert.ok(logs.some(message => message.includes('session disposal failed')));
      canExit = true; assert.equal((await drainLspSessionPool({ timeoutMs: 1000, killFirst: false })).status, 'ok');
    }
    const base = selected === 'different-root' ? path.join(root, 'other-root') : root;
    const replacement = await run(selected === 'different-root' ? 1 : 2, { base });
    assert.notEqual(replacement, first); assert.equal(first.settled, true); assert.equal(clients.length, 2);
    if (selected === 'different-root') assert.equal(await fs.readFile(path.join(root, 'source.js'), 'utf8'), doc(1).text);
  }
  assert.equal(pool.getMetrics().admissionWaiters, 0); assert.equal(pool.getMetrics().leaseQueueWaiters, 0);
} finally {
  canExit = true; held?.resolve(); creationGate?.resolve();
  await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
  hook.deregister(); delete globalThis.__vfsEpochClient;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`LSP original source epoch turnover: ${selected}`);
