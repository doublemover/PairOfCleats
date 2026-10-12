import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { createTypeIrArena, serializeTypeIrRoots } from '../../../src/index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph, mergeSymbolicTypeGraphs, normalizeTypeExpressions,
  validateTypeExpressionReferences } from '../../../src/shared/symbolic-types.js';
import { enqueueSymbolicTypeArtifacts } from '../../../src/index/build/artifacts/writers/symbolic-types.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadAndValidateManifest } from '../../../src/index/validate/manifest.js';
import { validateMetaV2Types } from '../../../src/index/validate/checks.js';
import { compactChunkMetaEntry } from '../../../src/index/build/artifacts/writers/chunk-meta/shared.js';
import { runCrossFileInference } from '../../../src/index/build/indexer/steps/relations/cross-file-runner.js';
import { openPublishedSymbolicTypeStore } from '../../../src/semantic/symbolic-type-store.js';
import { measureSymbolicResponseBytes } from '../../../src/semantic/symbolic-type-response.js';
import { readCrossFileInferenceCache, writeCrossFileInferenceCache } from '../../../src/index/type-inference-crossfile/cache.js';
import { getBuildsRoot } from '../../../src/shared/repo-paths.js';
import { runSemanticDetail } from '../../../src/integrations/tooling/semantic-detail.js';
import { runSemanticDetailCli } from '../../../tools/analysis/semantic-detail.js';
import { handleToolCall } from '../../../tools/mcp/tools.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const requiredFailure = reason => error => error?.code === 'ERR_TOOLING_REQUIRED_COMPUTATION_INCOMPLETE' && error.reason === reason;
for (const value of ['\u0000\b\t\n\f\r\\\"😀\ud800\udc00\ud800', [0, -0, null, true, false, 1e30, '\u2028'], { a: { b: ['', 'é'] }, omitted: undefined }]) {
  const bytes = Buffer.byteLength(JSON.stringify(value));
  assert.equal(measureSymbolicResponseBytes(value, bytes), bytes);
  assert.throws(() => measureSymbolicResponseBytes(value, bytes - 1), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
}
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-symbolic-roundtrip-'));
try {
  const repoRoot = path.join(fixture, 'repo');
  await fs.mkdir(repoRoot);
  applyTestEnv({ cacheRoot: path.join(fixture, 'cache'), testConfig: { indexing: { semantic: { enabled: false } } } });
  const generation = { baseBuildId: 'symbolic-build-a', semanticRevision: 0 };
  const outDir = path.join(getBuildsRoot(repoRoot), generation.baseBuildId, 'index-code');
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  const arena = createTypeIrArena({ contextKey: 'typescript:provider:config:source-snapshot' });
  const word = arena.union([arena.literal('a'), arena.literal('b')]);
  const root = arena.concat([arena.literal('prefix:'), word]);
  const singleton = arena.literal('one');
  const graph = createSymbolicTypeGraph(serializeTypeIrRoots(arena, [root, singleton]));
  const ref = { schemaVersion: 1, domain: 'finite-string', graphId: graph.graphId, contextKey: arena.contextKey, nodeId: root.id };
  const source = { sourceId: 'file:///fixture.ts', sourceHash: 'a'.repeat(64), start: 2, end: 42,
    origin: { kind: 'virtual', virtualPath: '.virtual/component.ts', containerPath: 'component.vue',
      segmentUid: 'segment-1', segmentRange: { start: 100, end: 200 }, mappingIdentity: 'mapping-1', mappingQuality: 'exact' } };
  const params = Object.create(null);
  params.__proto__ = [{ ...ref, nodeId: singleton.id }];
  const typeExpressions = normalizeTypeExpressions({ schemaVersion: 1, interpretation: 'declared-type-denotation', returnType: ref,
    params, declarationRef: source, display: {}, provenance: [source] });
  assert.throws(() => normalizeTypeExpressions({ ...typeExpressions, params: { p: [] } }), requiredFailure('symbolic_type_corrupt'));
  assert.equal(Object.getPrototypeOf(typeExpressions.params), null);
  assert.deepEqual(typeExpressions.provenance, [source]);
  assert.ok(Object.isFrozen(typeExpressions.declarationRef.origin.segmentRange));
  assert.equal(mergeSymbolicTypeGraphs([graph], [structuredClone(graph)]).length, 1);
  const otherSnapshot = createSymbolicTypeGraph(serializeTypeIrRoots(arena, [singleton]));
  assert.throws(() => mergeSymbolicTypeGraphs([graph], [otherSnapshot]), requiredFailure('symbolic_type_context_conflict'));
  validateTypeExpressionReferences(typeExpressions, [graph]);
  assert.throws(() => validateTypeExpressionReferences(typeExpressions, []), requiredFailure('symbolic_type_missing'));
  assert.throws(() => validateTypeExpressionReferences({ ...typeExpressions,
    returnType: { ...ref, contextKey: 'changed' } }, [graph]), requiredFailure('symbolic_type_corrupt'));
  const oversized = { ...typeExpressions, display: { params: { p: Array(20).fill('x'.repeat(16384)) } } };
  assert.throws(() => normalizeTypeExpressions(oversized), requiredFailure('symbolic_type_limit'));
  assert.throws(() => compactChunkMetaEntry({ id: 0, start: 0, end: 1, docmeta: { typeExpressions } }, 64), requiredFailure('symbolic_type_limit'));
  const chunks = [0, 1].map(id => ({ id, chunkUid: 'chunk-' + id, docmeta: { typeExpressions }, metaV2: { types: { expressions: typeExpressions } } }));
  const metadataReport = { issues: [], hints: [] };
  validateMetaV2Types(metadataReport, 'code', chunks);
  assert.deepEqual(metadataReport.issues, [], 'symbolic expressions have their own validator, not legacy type-entry traversal');
  validateMetaV2Types(metadataReport, 'code', [{ metaV2: { types: { expressions: { ...typeExpressions, interpretation: 'invalid' } } } }]);
  assert.equal(metadataReport.issues.length, 1, 'invalid symbolic envelopes are still rejected');
  const inferenceState = { chunks, symbolicTypeGraphs: [graph], fileRelations: new Map() };
  await runCrossFileInference({ runtime: { root: repoRoot, buildRoot: outDir, repoCacheRoot: path.join(fixture, 'runner-cache'),
    typeInferenceEnabled: true, typeInferenceCrossFileEnabled: true, toolingEnabled: false,
    riskAnalysisEnabled: false, riskAnalysisCrossFileEnabled: false, riskInterproceduralEnabled: false },
  mode: 'code', state: inferenceState, crashLogger: { updatePhase() {} } });
  assert.equal(inferenceState.symbolicTypeGraphs[0], graph, 'a prior tooling pass retains its shared inventory through non-tooling propagation');
  const registry = createArtifactPieceRegistry({ outDir });
  const writes = [], declarations = [];
  enqueueSymbolicTypeArtifacts({ state: { chunks, symbolicTypeGraphs: [graph] }, outDir,
    indexState: { buildId: generation.baseBuildId }, addPieceFile: registry.addPieceFile,
    declareArtifactFamily: value => declarations.push(value), enqueueWrite: (name, task) => writes.push(task) });
  assert.equal(writes.length, 1);
  assert.deepEqual(declarations[0].requiredMembers, ['symbolic_type_manifest', 'symbolic_type_graph']);
  for (const write of writes) await write();
  const pieces = registry.listPieceEntries();
  assert.equal(pieces.length, 2, 'one shared graph for two chunks, with a single family manifest');
  assert.equal(pieces.find(piece => piece.name === 'symbolic_type_graph').checksum, undefined,
    'normal piece publication owns the physical checksum; the graph manifest separately pins SHA256 content identity');
  await writePiecesManifest({ pieceEntries: pieces, outDir, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: generation.baseBuildId },
    abortSignal: new AbortController().signal });
  const publicationReport = { issues: [], warnings: [], hints: [] };
  await loadAndValidateManifest({ report: publicationReport, mode: 'code', dir: outDir, strict: true,
    modeReport: { ok: true, missing: [], warnings: [] } });
  assert.deepEqual(publicationReport.issues, []);
  assert.deepEqual(publicationReport.warnings, [], 'registered graph checksums use the supported normal manifest owner');
  const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'symbolic_type_manifest.json'), 'utf8'));
  assert.equal(validateArtifact('symbolic_type_manifest', manifest).ok, true);
  const store = await openPublishedSymbolicTypeStore({ indexDir: outDir, repoRoot, generation });
  assert.equal((await store.query({ ref, operation: 'membership', value: 'prefix:a' })).contains, true);
  assert.equal((await store.query({ ref, operation: 'membership', value: 'prefix:c' })).contains, false);
  const classified = await store.query({ ref, operation: 'classify' });
  assert.equal(classified.cardinality, 'many');
  assert.deepEqual(new Set(classified.witnesses), new Set(['prefix:a', 'prefix:b']));
  assert.equal((await store.query({ ref: { ...ref, nodeId: singleton.id }, operation: 'classify' })).cardinality, 'one');
  await assert.rejects(openPublishedSymbolicTypeStore({ indexDir: outDir, repoRoot,
    generation: { ...generation, baseBuildId: 'wrong-build' } }), requiredFailure('symbolic_type_generation_mismatch'));
  await assert.rejects(store.query({ ref: { ...ref, nodeId: 'tir1:' + '0'.repeat(64) }, operation: 'classify' }), requiredFailure('symbolic_type_missing'));
  await assert.rejects(store.query({ ref, operation: 'equivalence' }), requiredFailure('symbolic_type_unsupported'));
  await assert.rejects(store.query({ ref, operation: 'classify' }, { maxWitnessBytes: 3 }), requiredFailure('maxWitnessBytes_exceeded'));

  // Public existing detail runner and CLI both work without any semantic-family file.
  const request = { repoRoot, generation, refs: [], typeQueries: [{ ref, operation: 'membership', value: 'prefix:b' }] };
  const response = await runSemanticDetail(request);
  assert.equal(response.status, 'complete');
  assert.equal(response.typeResults[0].contains, true);
  assert.deepEqual(await handleToolCall('semantic_detail', request), response);
  const requestFile = path.join(fixture, 'request.json');
  await fs.writeFile(requestFile, JSON.stringify(request));
  let output = '';
  await runSemanticDetailCli(['node', 'semantic-detail.js', '--request', requestFile], {
    output: { write: value => { output += value; return true; } }
  });
  assert.deepEqual(JSON.parse(output), response);
  await assert.rejects(runSemanticDetail({ ...request, typeQueries: Array(17).fill(request.typeQueries[0]) }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });

  const cacheDir = path.join(fixture, 'replay'), cachePath = path.join(cacheDir, 'cache.json');
  await fs.mkdir(cacheDir);
  await writeCrossFileInferenceCache({ cacheDir, cachePath, chunks, crossFileFingerprint: 'fixed', stats: { symbolicTypeGraphs: [graph] } });
  const restored = chunks.map(chunk => ({ chunkUid: chunk.chunkUid }));
  const stats = await readCrossFileInferenceCache({ cachePath, chunks: restored, crossFileFingerprint: 'fixed', requireComplete: true });
  assert.equal(stats.symbolicTypeGraphs.length, 1);
  assert.deepEqual(restored[0].docmeta.typeExpressions.returnType, ref);
  assert.equal(JSON.parse(await fs.readFile(cachePath, 'utf8')).symbolicTypeGraphs.length, 1);
  const corrupt = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  corrupt.symbolicTypeGraphs = [];
  await fs.writeFile(cachePath, JSON.stringify(corrupt));
  const untouched = chunks.map(chunk => ({ chunkUid: chunk.chunkUid }));
  await assert.rejects(readCrossFileInferenceCache({ cachePath, chunks: untouched, crossFileFingerprint: 'fixed', requireComplete: true }), requiredFailure('symbolic_type_missing'));
  assert.equal(untouched[0].docmeta, undefined, 'invalid cache does not partially mutate chunks');

  const graphPath = path.join(outDir, manifest.graphs[0].path);
  const original = await fs.readFile(graphPath);
  await fs.writeFile(graphPath, Buffer.from(original).fill(120, original.length - 1));
  const corruptStore = await openPublishedSymbolicTypeStore({ indexDir: outDir, repoRoot, generation });
  await assert.rejects(corruptStore.query({ ref, operation: 'classify' }), requiredFailure('symbolic_type_corrupt'));
  await fs.unlink(graphPath);
  const missingStore = await openPublishedSymbolicTypeStore({ indexDir: outDir, repoRoot, generation });
  await assert.rejects(missingStore.query({ ref, operation: 'classify' }), requiredFailure('symbolic_type_missing'));
  console.log('Symbolic graph registered publication, pinned queries, public detail CLI, replay and fail-closed checks passed');
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
