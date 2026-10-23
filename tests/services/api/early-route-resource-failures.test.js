import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { withContainedFile, getContainedFileSession } from '../../../src/shared/contained-file.js';
import { withHttpRequestLifetime } from '../../../tools/api/router/request-lifetime.js';

// Six real adapters and their real request validators. Only the operation entry
// points are directed to a real held descriptor with an original close failure.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-route-owned-failure-'));
const file = path.join(root, 'retained.txt'); await fs.writeFile(file, 'retained');
const key = Symbol.for('poc.test.early-route-owned-failure'), originalOpen = fs.open, disposal = new Map();
const runners = {
  'semantic-detail.js': ['runSemanticDetail', 'classifySemanticDetailError'],
  'semantic-find.js': ['runSemanticFind'], 'semantic-trace.js': ['runSemanticTrace'],
  'semantic-explain.js': ['runSemanticExplain'],
  'semantic-enrichment.js': ['runSemanticEnrichment', 'classifySemanticEnrichmentError'],
  'runtime-evidence.js': ['runRuntimeEvidenceLookup', 'runRuntimeFamilyDiscovery', 'classifyRuntimeEvidenceError'],
  'runtime-claims.js': ['runRuntimeCaptureComparison', 'runRuntimeDerivedClaimLookup']
};
const hooks = registerHooks({ load(url, context, next) {
  const name = url.split('/').at(-1);
  if (url.includes('/integrations/tooling/') && runners[name]) return { format: 'module', shortCircuit: true,
    source: runners[name].map(exported => exported.startsWith('classify')
      ? `export const ${exported}=error=>({status:500,message:error.message});`
      : `export const ${exported}=async(_request,context)=>globalThis[Symbol.for('poc.test.early-route-owned-failure')](context.signal);`).join('\n') };
  return next(url, context);
} });
const generation = { baseBuildId: 'retained-route-build', semanticRevision: 0 };
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 0 }, scope = { repoRoot: root, generation };
const cases = [
  ['semantic', 'handleSemanticDetailRoute', { ...scope, refs: [ref] }],
  ['semantic-find', 'handleSemanticFindRoute', { ...scope, selector: { field: 'astKind', value: 'Identifier' } }],
  ['semantic-trace', 'handleSemanticTraceRoute', { ...scope, seed: ref, direction: 'downstream' }],
  ['semantic-explain', 'handleSemanticExplainRoute', { ...scope, seed: ref, direction: 'downstream' }],
  ['semantic-enrichment', 'handleSemanticEnrichmentRoute', { ...scope, schemaVersion: 1, action: 'plan' }],
  ['runtime-evidence', 'handleRuntimeEvidenceRoute', { schemaVersion: 1, repoRoot: root, destination: 'saved',
    limits: { maxFamilies: 1, maxScan: 1, maxBytes: 4096, maxMs: 1 }, cursor: null }]
];
const surfaces = () => {
  const req = new EventEmitter(), res = new EventEmitter(); let writes = 0;
  res.writeHead = () => { writes++; }; res.end = () => { res.writableEnded = true; };
  return { req, res, writes: () => writes, disconnect: () => { res.destroyed = true; res.emit('close'); } };
};
try {
  for (const [module, name, request] of cases) {
    const handler = (await import(`../../../tools/api/router/${module}.js`))[name];
    for (const seam of ['body', 'repository', 'operation']) {
      const surface = surfaces(); let deny = true, state;
      const originalFailure = Object.freeze(Object.assign(new Error('original close failed after disconnect'), { code: 'ENOENT' }));
      fs.open = async (...args) => {
        const handle = await originalOpen(...args), close = handle.close, read = handle.read;
        state = { handle, closes: 0, reads: 0 }; disposal.set(handle, () => close.call(handle));
        handle.read = function (...readArgs) { state.reads++; return read.call(handle, ...readArgs); };
        handle.close = async function () {
          state.closes++; if (deny) throw originalFailure;
          const value = await close.call(handle); disposal.delete(handle); return value;
        };
        return handle;
      };
      const failOriginalClose = signal => withContainedFile(root, file, async descriptor => {
        await descriptor.read(Buffer.alloc(1), 0, 1, 0); surface.disconnect();
        if (signal) assert.equal(signal.aborted, true);
      });
      globalThis[key] = signal => { assert.equal(seam, 'operation'); return failOriginalClose(signal); };
      let failure;
      try {
        await handler({ ...surface, operation: 'families',
          parseJsonBody: async () => seam === 'body' ? failOriginalClose() : request,
          resolveRepo: async () => seam === 'repository' ? failOriginalClose() : root });
        assert.fail('a disconnect cannot swallow the original pending descriptor failure');
      } catch (error) { failure = error; }
      assert.equal(surface.writes(), 0); assert.equal(failure.cacheOwnershipReleased(), false);
      const session = getContainedFileSession(failure); assert.ok(session, module);
      assert.equal(state.closes, 1); deny = false; await session.releaseAfterClose();
      assert.equal(state.handle.fd, -1); assert.equal(state.closes, 2); assert.equal(state.reads, 1);
      assert.equal(failure.cacheOwnershipReleased(), true);
      for (const [emitter, event] of [[surface.req, 'aborted'], [surface.req, 'error'], [surface.res, 'close'], [surface.res, 'error']]) {
        assert.equal(emitter.listenerCount(event), 0, module + ':' + event);
      }
      fs.open = originalOpen;
    }
  }
  {
    const surface = surfaces(); let finish, workSettled = false, returned = false;
    const pendingWork = new Promise(resolve => { finish = () => { workSettled = true; resolve('settled'); }; });
    const pending = withHttpRequestLifetime(surface.req, surface.res, lifetime => {
      surface.disconnect(); return lifetime.prepare(pendingWork);
    });
    const completion = pending.then(() => { returned = true; });
    await Promise.resolve(); assert.equal(returned, false, 'already-started preparation must remain awaited after disconnect');
    finish(); await completion; assert.equal(workSettled, true);
  }
} finally {
  hooks.deregister(); delete globalThis[key]; fs.open = originalOpen;
  for (const close of disposal.values()) await close(); await fs.rm(root, { recursive: true, force: true });
}
console.log('Early HTTP lifetimes retain original pending descriptors after disconnect and drain started preparation.');
