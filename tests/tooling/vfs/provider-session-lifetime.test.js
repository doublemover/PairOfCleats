import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createVfsMaterializationSession, ensureVfsDiskDocument } from '../../../src/index/tooling/vfs/disk.js';

// UNVALIDATED: actual pool/materializer, inert client disposal, tiny real files.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['idle', 'single', 'cancelled', 'unconfirmed', 'shared-consumers', 'external-mutation', 'pending-publication', 'pending-cache-owner'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'vfs-consumer-'));
let confirmed = selected !== 'unconfirmed', resourceReady = false, nativeCreations = 0, nativeKills = 0, settledKills = null;
const logs = [];
globalThis.__vfsLifetimeClient = () => {
  nativeCreations++; let settled = false;
  const listeners = new Set(), evidence = () => ({ settled, exitObserved: settled, closeObserved: settled, pending: !settled });
  const client = { getGeneration: () => 1, isTransportRunning: () => !settled, getTerminationEvidence: evidence,
    waitForResourceSettlement: async () => evidence(),
    onResourcesSettled(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    shutdownAndExit: async () => {}, killSync() {},
    async kill() {
      nativeKills++;
      if (confirmed) { settled = true; for (const listener of listeners) listener(); }
      return { ...evidence(), terminated: settled };
    } };
  return client;
};
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/lsp/client.js')) return { format: 'module', shortCircuit: true,
    source: 'export const createLspClient = () => globalThis.__vfsLifetimeClient();' };
  return next(url, context);
} });
const { withLspSession, drainLspSessionPool } = await import('../../../src/integrations/tooling/providers/lsp/session-pool.js');
const options = { repoRoot: root, cmd: 'inert-vfs-consumer', enabled: !['single', 'cancelled'].includes(selected),
  log: message => logs.push(message), timeoutMs: 1000, retries: 0, sessionIdleTimeoutMs: 10000 };
const doc = { baseDir: root, virtualPath: 'src/document.js', docHash: 'content-A', text: 'const value = 1;\n' };
const replacement = { ...doc, docHash: 'content-B', text: 'const value = 2;\n' };
let disk, scope;
const conflicts = () => assert.rejects(ensureVfsDiskDocument(replacement), { code: 'ERR_VFS_MATERIALIZATION_CONFLICT' });
try {
  if (selected === 'pending-publication') {
    let unblock; const gate = new Promise(resolve => { unblock = resolve; });
    const open = fs.open; let entered;
    const started = new Promise(resolve => { entered = resolve; });
    scope = createVfsMaterializationSession({ isClosed: () => true });
    fs.open = async (file, ...args) => {
      if (String(file).includes('document.js.tmp-')) { entered(); await gate; }
      return open(file, ...args);
    };
    let pending;
    try {
      pending = ensureVfsDiskDocument({ ...doc, materializationSession: scope }); await started;
      assert.throws(() => scope.releaseAfterClosure(), 'retirement waits for every started publication');
    } finally { unblock(); fs.open = open; if (pending) disk = await pending; }
    scope.releaseAfterClosure(); scope = null;
  } else {
    const cancel = Object.assign(new Error('controlled collection cancellation'), { name: 'AbortError' });
    const work = () => withLspSession(options, async lease => {
      scope = lease.materializationSession;
      disk = await ensureVfsDiskDocument({ ...doc, materializationSession: scope,
        ...(selected === 'pending-cache-owner' ? { coldStartCache: { set() { throw pendingOwner; } } } : {}) });
      assert.equal(scope.size, 1); assert.equal(await fs.readFile(disk.path, 'utf8'), doc.text);
      if (selected === 'single' || selected === 'cancelled') await conflicts();
      if (selected === 'cancelled') throw cancel;
    });
    const pendingOwner = Object.freeze(Object.assign(new Error('original cache publication remains outstanding'), {
      cacheOwnershipReleased() { assert.equal(this, pendingOwner); return resourceReady; }
    }));
    if (selected === 'cancelled') await assert.rejects(work(), error => error === cancel);
    else if (selected === 'pending-cache-owner') {
      await assert.rejects(work());
      await assert.rejects(ensureVfsDiskDocument(replacement));
      assert.equal((await drainLspSessionPool({ timeoutMs: 1000, killFirst: false })).status, 'failed');
      settledKills = nativeKills;
      assert.ok(logs.some(message => message.includes('session disposal failed')));
      resourceReady = true;
    } else await work();
    if (options.enabled && selected !== 'pending-cache-owner') {
      await conflicts();
      assert.equal(await fs.readFile(disk.path, 'utf8'), doc.text, 'finished collection does not retire the idle client reader');
      if (selected === 'idle' || selected === 'shared-consumers') {
        const originalScope = scope;
        await withLspSession({ ...options, ...(selected === 'shared-consumers' ? { enabled: false, providerId: 'other' } : {}) }, async lease => {
          if (selected === 'idle') assert.equal(lease.materializationSession, originalScope);
          const reused = await ensureVfsDiskDocument({ ...doc, materializationSession: lease.materializationSession });
          assert.equal(reused.cacheHit, true); assert.equal(await fs.readFile(reused.path, 'utf8'), doc.text);
        });
        await conflicts();
      }
      if (selected === 'external-mutation') {
        await fs.writeFile(disk.path, replacement.text);
        await assert.rejects(withLspSession(options, async lease => ensureVfsDiskDocument({ ...doc, materializationSession: lease.materializationSession })),
          { code: 'ERR_VFS_MATERIALIZATION_CHANGED' });
        assert.equal(await fs.readFile(disk.path, 'utf8'), replacement.text, 'changed active URI is refused without a hidden rewrite');
      }
      if (selected === 'unconfirmed') {
        const failed = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false });
        assert.equal(failed.status, 'failed'); await conflicts();
        assert.equal(nativeCreations, 1); confirmed = true;
      }
    }
  }
  confirmed = true; resourceReady = true;
  const drained = await drainLspSessionPool({ timeoutMs: 1000, killFirst: false }); assert.equal(drained.status, 'ok');
  if (settledKills !== null) assert.equal(nativeKills, settledKills, 'materialization recovery does not repeat confirmed transport disposal');
  const result = await ensureVfsDiskDocument(replacement); assert.equal(await fs.readFile(result.path, 'utf8'), replacement.text);
  if (scope) {
    assert.equal(scope.size, 0);
    await assert.rejects(ensureVfsDiskDocument({ ...doc, virtualPath: 'retired.js', materializationSession: scope }), TypeError);
  }
} finally {
  confirmed = true; resourceReady = true;
  await drainLspSessionPool({ timeoutMs: 1000, killFirst: false }); scope?.releaseAfterClosure();
  hook.deregister(); delete globalThis.__vfsLifetimeClient;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`VFS materialization survives original provider lifetime: ${selected}`);
