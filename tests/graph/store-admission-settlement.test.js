import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { createGraphStoreFixture, chunkCallGraphRelations } from './helpers/graph-fixtures.js';
import { withContainedFile, readVerifiedContainedFile, getContainedFileSession } from '../../src/shared/contained-file.js';

const key = Symbol.for('poc.graph-admission-owners');
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/artifact-io/loaders/graph.js')) return { format: 'module', shortCircuit: true,
    source: `export const loadGraphRelations=()=>globalThis[Symbol.for('poc.graph-admission-owners')].graph();
export const loadGraphRelationsCsr=()=>globalThis[Symbol.for('poc.graph-admission-owners')].csr();` };
  return next(url, context);
} });
const { createGraphStore } = await import('../../src/graph/store.js');
const { tmpDir } = createGraphStoreFixture({ prefix: 'graph-admission-settlement-', graphRelations: chunkCallGraphRelations(),
  extraPieces: [{ name: 'graph_relations_csr', path: 'pieces/graph_relations.csr.json' }] });
const graphFile = path.join(tmpDir, 'pieces', 'graph_relations.json'), csrFile = path.join(tmpDir, 'pieces', 'graph_relations.csr.json');
await fs.writeFile(csrFile, '{}');
let release, csrEntered, graphFailed;
const gate = new Promise(resolve => { release = resolve; });
const entered = new Promise(resolve => { csrEntered = resolve; });
const firstRejected = new Promise(resolve => { graphFailed = resolve; });
const originalOpen = fs.open;
let mode = 'failure', graphCalls = 0, csrCalls = 0, handle, close, closes = 0, reads = 0, deny = true;
const primary = Object.freeze(Object.assign(new Error('first actual graph source failure'), { code: 'ERR_GRAPH_SOURCE' }));
try {
  fs.open = async (file, ...args) => {
    const opened = await originalOpen(file, ...args);
    if (path.resolve(String(file)) === csrFile && mode === 'failure') {
      handle = opened; close = opened.close; const read = opened.read;
      opened.read = function (...readArgs) { reads++; return read.call(opened, ...readArgs); };
      opened.close = async function () { closes++; if (deny) throw new Error('independent original close failed'); return close.call(opened); };
    }
    return opened;
  };
  globalThis[key] = {
    graph: async () => {
      graphCalls++; const snapshot = await readVerifiedContainedFile(tmpDir, graphFile, { maxBytes: 4096 });
      if (mode === 'failure') { graphFailed(); throw primary; }
      return JSON.parse(snapshot.buffer.toString('utf8'));
    },
    csr: () => { csrCalls++; return withContainedFile(tmpDir, csrFile, async descriptor => {
      await descriptor.read(Buffer.alloc(1), 0, 1, 0);
      if (mode === 'failure') { csrEntered(); await gate; }
      return null;
    }); }
  };
  const store = createGraphStore({ indexDir: tmpDir }); let returned = false;
  const options = { graphs: ['callGraph'], cacheKey: 'owned-admission', includeCsr: true, indexSignature: 'retained-graph' };
  const pending = store.loadGraphIndex(options).then(value => { returned = true; return value; }, error => { returned = true; return error; });
  await Promise.all([entered, firstRejected]); await new Promise(setImmediate);
  assert.equal(returned, false, 'a first rejected artifact must not abandon another admitted native owner');
  release(); const failure = await pending;
  assert.equal(failure.code, primary.code); assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(closes, 1);
  const nested = failure.errors.find(error => getContainedFileSession(error));
  assert.ok(nested); deny = false; await getContainedFileSession(nested).releaseAfterClose();
  assert.equal(handle.fd, -1); assert.equal(closes, 2); assert.equal(reads, 1);
  assert.equal(failure.cacheOwnershipReleased(), true);
  mode = 'success'; fs.open = originalOpen;
  const successful = await store.loadGraphIndex(options);
  assert.ok(successful); assert.equal(graphCalls, 2); assert.equal(csrCalls, 2, 'failed multi-artifact admission published no shared partial artifact cache');
  assert.equal(await store.loadGraphIndex(options), successful); assert.equal(graphCalls, 2);
} finally {
  release(); hooks.deregister(); delete globalThis[key]; fs.open = originalOpen;
  if (handle?.fd !== undefined && handle.fd !== -1) await close.call(handle);
  await fs.rm(tmpDir, { recursive: true, force: true });
}
console.log('Graph artifact admission drains actual readers and retains every original resource prerequisite.');
