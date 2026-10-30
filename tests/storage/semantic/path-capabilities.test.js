import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { createSemanticExplainService } from '../../../src/semantic/explain.js';
import { getSemanticPathCapabilityDeclarations } from '../../../src/semantic/path-capabilities.js';
import { SEMANTIC_PATH_DECLARATION_SCHEMA } from '../../../src/contracts/schemas/semantic-path.js';
import { compileSchema, createAjv } from '../../../src/shared/validation/ajv-factory.js';
import { assertSemanticTrace } from '../../../src/contracts/validators/semantic-trace.js';
import { withContainedFile, getContainedFileSession } from '../../../src/shared/contained-file.js';

const fixture = await createRecoveryFixture('first(argument); second(other);');
const originalOpen = fs.open, disposal = new Map();
const ref = localId => ({ partitionId: fixture.partitionId, localId });
const nodes = Array.from({ length: 9 }, (_, id) => semanticNode(id, fixture.source.textLength));
for (const id of [0, 4]) Object.assign(nodes[id].row.data, { invocationKind: 'call', syntacticArgumentCount: 1 });
nodes[2] = { family: 'node', row: { id: 2, kind: 'declaration', span: [0, 1], scope: null,
  data: { nameId: 0, declarationKind: 'parameter', flags: [], initializer: null, typeSyntax: null } } };
nodes[3] = { family: 'node', row: { id: 3, kind: 'value', span: null, scope: null, data: { origin: 'return', site: ref(2), storage: null } } };
nodes[7] = { family: 'node', row: { id: 7, kind: 'evidence', span: null, scope: null, data: {
  method: 'bounded-fixture', producerId: 'fixture', producerVersion: '1', evidenceKind: 'static',
  sourceRef: fixture.source.sourceUnitId, artifactRef: null
} } };
nodes.push({ family: 'lookup', row: { kind: 'name', id: 0, value: 'parameter' } });
const edge = (id, kind, from, to, site = null, contextKey = null, operandOrdinal = null, certainty = 'modeled') => ({
  family: 'edge', row: { id, kind, from: ref(from), to: ref(to), callSite: site === null ? null : ref(site),
    contextKey, operandOrdinal, condition: null, evidence: ref(7), certainty }
});
const edges = [edge(0, 'argumentToParameter', 1, 2, 0, 'context-a', 0), edge(1, 'flowsTo', 2, 3),
  edge(2, 'returnToResult', 3, 5, 0, 'context-a'), edge(3, 'returnToResult', 3, 6, 4, 'context-a'),
  edge(4, 'returnToResult', 3, 6, 0, 'context-b'), edge(5, 'argumentToParameter', 8, 2, 4, 'context-a', 0)];
const createStore = async (rows, overrides = {}) => {
  const partition = await fixture.write([...nodes, ...rows], overrides);
  const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
    partitions: [partition], store: fixture.store([partition]), diskAccount: fixture.account });
  return { store: fixture.store([partition], { queryIndex }), partition };
};
try {
  const validateDeclaration = compileSchema(createAjv({ allErrors: true, strict: true }), SEMANTIC_PATH_DECLARATION_SCHEMA);
  const declarations = getSemanticPathCapabilityDeclarations(); assert.equal(declarations.length, 3);
  for (const declaration of declarations) {
    assert.equal(validateDeclaration(declaration), true); assert.equal(declaration.feasibility, 'unsupported');
  }
  assert.equal(declarations.find(row => row.semantics === 'graph-witness').referenceKind, 'graph-node-ref');
  assert.equal(validateDeclaration({ ...declarations[0], referenceKind: 'graph-node-ref' }), false);
  const { store, partition } = await createStore(edges);
  const request = { repoRoot: fixture.root, generation: fixture.generation, seed: ref(1), direction: 'downstream',
    kinds: ['argumentToParameter', 'flowsTo', 'returnToResult'], limits: { depth: 12 } };
  const trace = createSemanticTraceService();
  const balanced = await trace({ store, request: { ...request, pathSemantics: 'balanced-call-value' } });
  const neighborhood = await trace({ store, request: { ...request, pathSemantics: 'relation-neighborhood' } });
  assert.ok(balanced.records.some(row => row.id === 5)); assert.ok(!balanced.records.some(row => row.id === 6));
  assert.ok(neighborhood.records.some(row => row.id === 6), 'unrestricted relations retain both caller returns and mixed context keys');
  assert.equal(balanced.pathCapability.declaration.contextPolicy, 'prefix-balanced-call-site-and-context-key');
  assert.equal(neighborhood.pathCapability.limits.callContextDepth, 0);
  assert.equal(balanced.pathCapability.scope.inventory, store.cursorScope);
  assert.deepEqual(balanced.pathCapability.scope.generation, fixture.generation);
  const reverse = await trace({ store, request: { ...request, seed: ref(5), direction: 'upstream', pathSemantics: 'balanced-call-value' } });
  assert.ok(reverse.records.some(row => row.id === 1)); assert.ok(!reverse.records.some(row => row.id === 8));
  for (const semantics of ['graph-witness', 'feasible-path']) await assert.rejects(trace({ store,
    request: { ...request, pathSemantics: semantics } }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  await assert.rejects(trace({ store, request: { ...request, pathSemantics: 'balanced-call-value', kinds: ['executedPath'] } }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  await assert.rejects(trace({ store, request: { ...request, pathSemantics: 'balanced-call-value',
    generation: { ...fixture.generation, baseBuildId: 'foreign' } } }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  const changed = structuredClone(balanced); changed.pathCapability.scope.generation.baseBuildId = 'foreign';
  assert.throws(() => assertSemanticTrace('result', changed), /generation/);
  const future = structuredClone(balanced); future.pathCapability.declaration.schemaVersion = 2;
  assert.throws(() => assertSemanticTrace('result', future), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
  const explained = await createSemanticExplainService()({ store,
    manifest: { generation: fixture.generation, partitions: [partition], completedTasks: [] },
    request: { ...request, pathSemantics: 'balanced-call-value' } });
  assert.equal(explained.pathCapability.declaration.operation, 'semantic_explain');
  assert.ok(Buffer.byteLength(JSON.stringify(explained)) <= explained.pathCapability.limits.bytes);
  const paged = createSemanticTraceService({ maxContinuations: 1 });
  const firstRequest = { ...request, pathSemantics: 'balanced-call-value', limits: { records: 1, depth: 12 } };
  const first = await paged({ store, request: firstRequest }); assert.ok(first.cursor);
  assert.ok(first.frontier.some(row => row.reason === 'record_budget'));
  const depthPage = await trace({ store, request: { ...request, pathSemantics: 'balanced-call-value', limits: { depth: 1 } } });
  assert.ok(depthPage.frontier.some(row => row.reason === 'depth_budget'));
  const edgePage = await trace({ store, request: { ...request, pathSemantics: 'balanced-call-value', limits: { edges: 1 } } });
  assert.ok(edgePage.frontier.some(row => row.reason === 'edge_budget'));
  const empty = await trace({ store, request: { ...request, seed: ref(99), pathSemantics: 'balanced-call-value' } });
  assert.equal(empty.records.length, 0); assert.ok(empty.frontier.some(row => row.reason === 'record_not_found'));
  await assert.rejects(trace({ store, request: { ...request, pathSemantics: 'balanced-call-value',
    limits: { bytes: 512 } } }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  const slowStore = { ...store, getRecords: async (...args) => { const rows = await store.getRecords(...args); await delay(2); return rows; } };
  const workPage = await trace({ store: slowStore, request: { ...request, pathSemantics: 'balanced-call-value', limits: { workMs: 1 } } });
  assert.ok(workPage.frontier.some(row => row.reason === 'work_budget')); assert.ok(workPage.cursor);
  await assert.rejects(paged({ store, request: { ...firstRequest, pathSemantics: 'relation-neighborhood', cursor: first.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  const explainPage = createSemanticExplainService({ maxContinuations: 1 });
  const explainInventory = { generation: fixture.generation, partitions: [partition], completedTasks: [] };
  const firstExplanation = await explainPage({ store, manifest: explainInventory, request: firstRequest });
  assert.ok(firstExplanation.cursor);
  await assert.rejects(explainPage({ store, manifest: { ...explainInventory,
    generation: { ...fixture.generation, baseBuildId: 'foreign' } }, request: firstRequest }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  assert.ok((await explainPage({ store, manifest: explainInventory,
    request: { ...firstRequest, cursor: firstExplanation.cursor } })).records.length > 0,
  'a rejected final explanation must preserve the last delivered continuation');
  {
    let deny = true, state;
    fs.open = async (file, ...args) => {
      const handle = await originalOpen(file, ...args);
      if (path.resolve(String(file)) !== path.resolve(fixture.original)) return handle;
      const close = handle.close; state = { handle, closes: 0 }; disposal.set(handle, () => close.call(handle));
      handle.close = async function () {
        state.closes++; if (deny) throw new Error('original post-page descriptor close failed');
        const value = await close.call(handle); disposal.delete(handle); return value;
      }; return handle;
    };
    const withheldStore = { ...store, withReadScope: run => store.withReadScope(async () => {
      const value = await run(); return withContainedFile(fixture.root, fixture.original, () => value);
    }) };
    let failure;
    try { await paged({ store: withheldStore, request: firstRequest }); assert.fail('must withhold failed cleanup'); }
    catch (error) { failure = error; }
    assert.equal(failure.cacheOwnershipReleased(), false); deny = false;
    await getContainedFileSession(failure).releaseAfterClose(); assert.equal(state.handle.fd, -1); assert.equal(state.closes, 2);
    fs.open = originalOpen;
    const resumed = await paged({ store, request: { ...firstRequest, cursor: first.cursor } });
    assert.ok(resumed.records.length > 0, 'a withheld page cannot evict the last delivered continuation');
  }
  for (const [fault, selected, expected] of [
    [edge(0, 'argumentToParameter', 1, 2, 0, 'context-a', 2, 'exact-static'), 1, 'integrity'],
    [edge(0, 'argumentToParameter', 7, 2, 0, 'context-a', 0), 7, 'integrity'],
    [edge(0, 'argumentToParameter', 1, 2, null, null, 0), 1, 'call_context_unavailable'],
    [edge(0, 'argumentToParameter', 1, 2, 0, 'context-a', null), 1, 'call_operand_unavailable'],
    [edge(0, 'argumentToParameter', 1, 2, 0, 'context-a', 2), 1, 'operand_validation_unavailable']
  ]) {
    const broken = await createStore([fault]);
    const run = () => trace({ store: broken.store, request: { ...request, seed: ref(selected), pathSemantics: 'balanced-call-value' } });
    if (expected === 'integrity') await assert.rejects(run(), { code: 'ERR_SEMANTIC_INTEGRITY' });
    else { const page = await run(); assert.ok(page.frontier.some(row => row.reason === expected)); assert.equal(page.status, 'partial'); assert.equal(page.edges.length, 1); }
  }
  const recursive = await createStore([edge(0, 'argumentToParameter', 2, 2, 0, 'recursive', 0)]);
  const recursion = await trace({ store: recursive.store, request: { ...request, seed: ref(2),
    pathSemantics: 'balanced-call-value', limits: { depth: 64 } } });
  assert.ok(recursion.frontier.some(row => row.reason === 'call_context_budget'));
  const controller = new AbortController(), active = new Set();
  fs.open = async (...args) => {
    const handle = await originalOpen(...args), close = handle.close; active.add(handle); controller.abort();
    handle.close = async function () { const value = await close.call(handle); active.delete(handle); return value; }; return handle;
  };
  try { await assert.rejects(trace({ store, request: { ...request, pathSemantics: 'balanced-call-value' }, signal: controller.signal }), { code: 'ABORT_ERR' }); }
  finally { fs.open = originalOpen; }
  assert.equal(active.size, 0);
} finally { fs.open = originalOpen; for (const close of disposal.values()) await close(); await fixture.cleanup(); }
console.log('Semantic path declarations govern bounded retained traversal, context validation and continuation publication.');
