import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTypeIrArena, serializeTypeIrRoots, deserializeTypeIr } from '../../../src/index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph, validateSymbolicTypeGraph, mergeSymbolicTypeGraphs,
  getSymbolicTypeGraphMeasurement } from '../../../src/shared/symbolic-types.js';
import { enqueueSymbolicTypeArtifacts } from '../../../src/index/build/artifacts/writers/symbolic-types.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { openPublishedSymbolicTypeStore } from '../../../src/semantic/symbolic-type-store.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareArtifactIoTestDir } from '../../helpers/artifact-io-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const arena = createTypeIrArena({ contextKey: 'snapshot-ownership' }), root = arena.literal('original 雪');
const expected = createSymbolicTypeGraph(serializeTypeIrRoots(arena, [root]));
let admitted;
for (const mutate of [raw => { raw.graph.nodes[0].value = 'changed'; }, raw => { raw.graph.rootIds.length = 0; },
  raw => { raw.graph.contextKey = 'changed'; }, raw => { raw.graphId = 'stg1:' + 'a'.repeat(64); }]) {
  const raw = structuredClone(expected);
  admitted = validateSymbolicTypeGraph(raw, { onHydrated: () => mutate(raw) });
  assert.notEqual(admitted, raw); assert.deepEqual(admitted, expected);
  assert.equal(validateSymbolicTypeGraph(admitted), admitted);
  assert.equal(mergeSymbolicTypeGraphs([], [admitted])[0], admitted);
  assert.equal(deserializeTypeIr(admitted.graph).root.value, root.value);
  assert.equal(admitted.graphId, 'stg1:' + getSymbolicTypeGraphMeasurement(admitted).hash);
}
const mutable = structuredClone(expected);
const fromSignal = validateSymbolicTypeGraph(mutable, { signal: { get aborted() { mutable.graph.nodes[0].value = 'signal changed'; return false; } } });
assert.deepEqual(fromSignal, expected);
assert.throws(() => getSymbolicTypeGraphMeasurement(structuredClone(expected)), /owned admitted entry/);
let getters = 0;
const accessor = structuredClone(expected);
Object.defineProperty(accessor.graph.nodes[0], 'value', { enumerable: true, get() { getters++; return root.value; } });
assert.throws(() => validateSymbolicTypeGraph(accessor)); assert.equal(getters, 0);
const decorated = structuredClone(expected);
Object.defineProperty(decorated.graph.nodes, 'extra', { value: true });
assert.throws(() => validateSymbolicTypeGraph(decorated));
const proxy = new Proxy(structuredClone(expected.graph), { ownKeys() { getters++; throw new Error('proxy executed'); } });
assert.throws(() => validateSymbolicTypeGraph({ graphId: expected.graphId, graph: proxy })); assert.equal(getters, 0);
const tooMany = structuredClone(expected); tooMany.graph.nodes = Array(100001).fill(tooMany.graph.nodes[0]);
assert.throws(() => validateSymbolicTypeGraph(tooMany), error => error.reason === 'symbolic_type_limit');

const outDir = await prepareArtifactIoTestDir('symbolic-type-admission-ownership');
const writes = [], generation = { baseBuildId: 'owned-graph', semanticRevision: 0 };
const registry = createArtifactPieceRegistry({ outDir });
enqueueSymbolicTypeArtifacts({ state: { symbolicTypeGraphs: [admitted], chunks: [] }, outDir,
  indexState: { buildId: generation.baseBuildId }, enqueueWrite: (_label, write) => writes.push(write),
  addPieceFile: registry.addPieceFile, declareArtifactFamily() {} });
for (const write of writes) await write();
await writePiecesManifest({ pieceEntries: registry.listPieceEntries(), outDir, mode: 'code',
  indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId }, abortSignal: new AbortController().signal });
const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'symbolic_type_manifest.json'), 'utf8'));
assert.equal(manifest.graphs[0].graphId, 'stg1:' + manifest.graphs[0].hash);
const store = await openPublishedSymbolicTypeStore({ indexDir: outDir, repoRoot: process.cwd(), generation });
const ref = { schemaVersion: 1, domain: 'finite-string', graphId: admitted.graphId, contextKey: arena.contextKey, nodeId: root.id };
assert.equal((await store.query({ ref, operation: 'membership', value: root.value })).contains, true);
assert.equal((await store.query({ ref, operation: 'membership', value: 'changed' })).contains, false);
console.log('symbolic type admission ownership passed');
