import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const variant = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/tree-sitter/worker-session-lifecycle/')[1];
assert.ok(variant);
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const key = Symbol.for('poc.tree-worker-lifecycle'), imported = gate(), entered = gate();
const state = { pools: [], closed: [], resolveFailed: false, deny: false, onConstruct: null,
  entered, imported, failure: Object.freeze(Object.assign(new Error('original pool close unconfirmed'), { cacheOwnershipPending: true })) };
globalThis[key] = state;
const access = 'const state = globalThis[Symbol.for("poc.tree-worker-lifecycle")];';
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/tree-sitter/worker.js')) {
      if (specifier === 'piscina') {
        if (variant === 'import-failure-retry' && !state.resolveFailed) { state.resolveFailed = true; throw new Error('controlled import resolution failure'); }
        return { url: 'worker-lifecycle:piscina', shortCircuit: true };
      }
      if (specifier.endsWith('/piscina-cleanup.js')) return { url: 'worker-lifecycle:cleanup', shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === 'worker-lifecycle:piscina') return { format: 'module', shortCircuit: true, source: access + `
      state.entered.resolve(); await state.imported.promise;
      export default class Pool { constructor(config) { this.config=config; this.threads=[]; this.queueSize=0; state.pools.push(this); state.onConstruct?.(); }
        async destroy() { state.closed.push(this); } async run() { return []; } }
    ` };
    if (url === 'worker-lifecycle:cleanup') return { format: 'module', shortCircuit: true, source: access + `
      export async function destroyPiscinaPool(pool) { if(state.deny) throw state.failure; await pool.destroy(); return {timedOut:false}; }
    ` };
    return next(url, context);
  }
});
const views = [];
try {
  const { getTreeSitterWorkerPool: get, shutdownTreeSitterWorkerPool: shutdown } = await import('../../../src/lang/tree-sitter/worker.js');
  const { treeSitterState } = await import('../../../src/lang/tree-sitter/state.js');
  const a = { enabled: true, maxWorkers: 1, maxQueue: 4 }, b = { ...a, maxQueue: 5 };
  const start = get(a);
  if (variant === 'import-failure-retry') {
    assert.equal(await start, null); state.imported.resolve(); const recovered = await get(a); assert.ok(recovered); views.push(recovered);
  } else {
    await entered.promise;
    if (variant === 'shutdown-import') {
      const closing = shutdown(); let settled = false; closing.then(() => { settled = true; });
      await tick(); assert.equal(settled, false); imported.resolve(); assert.equal(await start, null); await closing;
      assert.equal(state.pools.length, 0);
    } else if (variant === 'stale-close-failure') {
      let closing; state.deny = true;
      state.onConstruct = () => { state.onConstruct = null; closing = shutdown(); closing.catch(() => {}); };
      const rejected = assert.rejects(start, error => error === state.failure); imported.resolve(); await rejected;
      await assert.rejects(closing, error => error === state.failure);
      assert.equal(treeSitterState.treeSitterWorkerPool, state.pools[0]);
      await assert.rejects(get(a), error => error === state.failure);
      assert.equal(state.closed.length, 0); state.deny = false; await shutdown();
    } else {
      const extra = variant === 'same-config' ? Array.from({ length: 7 }, () => get(a)) : [];
      imported.resolve(); const first = await start; views.push(first);
      if (variant === 'same-config') for (const pool of await Promise.all(extra)) assert.equal(pool, first);
      if (variant === 'conflicting-config') {
        const [old, next] = await Promise.all([get(a), get(b)]); assert.equal(old, first); assert.notEqual(old, next);
        views.push(next);
        await assert.rejects(old.run(), { code: 'ERR_TREE_SITTER_WORKER_RETIRED' });
        assert.equal(state.closed.filter(pool => pool === state.pools[0]).length, 1);
      }
      if (variant === 'shutdown-reconfigure') {
        let release; const barrier = new Promise(resolve => { release = resolve; });
        state.pools[0].destroy = async () => { await barrier; state.closed.push(state.pools[0]); };
        const change = get(b); await tick(); const closing = shutdown(); await tick(); release();
        assert.equal(await change, null); await closing; assert.equal(state.pools.length, 1);
      }
      if (variant === 'destroy-failure') {
        state.deny = true; await assert.rejects(shutdown(), error => error === state.failure);
        assert.equal(treeSitterState.treeSitterWorkerPool, state.pools[0]);
        await assert.rejects(get(b), error => error === state.failure);
        state.deny = false;
      }
    }
  }
  await shutdown(); await shutdown();
  assert.equal(treeSitterState.treeSitterWorkerPool, null);
  for (const view of views) await assert.rejects(view.run(), { code: 'ERR_TREE_SITTER_WORKER_RETIRED' });
  assert.equal(new Set(state.closed).size, state.pools.length);
  assert.equal(state.closed.length, state.pools.length, 'each constructed handle is retired exactly once');
} finally { imported.resolve(); hooks.deregister(); delete globalThis[key]; }
console.log('Tree-sitter worker single-flight, reconfiguration and late-failure ownership: ' + variant);
