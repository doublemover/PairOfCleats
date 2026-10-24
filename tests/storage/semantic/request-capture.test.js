import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { SEMANTIC_DETAIL_REQUEST_SCHEMA } from '../../../src/contracts/schemas/semantic-query.js';
import { SEMANTIC_FIND_REQUEST_SCHEMA } from '../../../src/contracts/schemas/semantic-find.js';
import { SEMANTIC_TRACE_REQUEST_SCHEMA } from '../../../src/contracts/schemas/semantic-trace.js';
import { assertSemanticQuery } from '../../../src/contracts/validators/semantic-query.js';
import { assertSemanticFind } from '../../../src/contracts/validators/semantic-find.js';
import { classifySemanticDetailError } from '../../../src/integrations/tooling/semantic-errors.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSemanticFindService } from '../../../src/semantic/find.js';
import { createSemanticTraceService } from '../../../src/semantic/trace.js';
import { createSemanticDetailRunner } from '../../../src/integrations/tooling/semantic-detail.js';
import { createSemanticFindRunner } from '../../../src/integrations/tooling/semantic-find.js';
import { createSemanticTraceRunner } from '../../../src/integrations/tooling/semantic-trace.js';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createTypeIrArena, serializeTypeIrRoots } from '../../../src/index/tooling/typescript/type-ir/index.js';
import { createSymbolicTypeGraph } from '../../../src/shared/symbolic-types.js';
import { enqueueSymbolicTypeArtifacts } from '../../../src/index/build/artifacts/writers/symbolic-types.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { getBuildsRoot } from '../../../src/shared/repo-paths.js';
import { openPublishedSymbolicTypeStore } from '../../../src/semantic/symbolic-type-store.js';

// UNVALIDATED. Real retained-row/type writers and readers, with deliberately
// mutating caller/store callbacks. No native/provider/full-index qualification.
const f = await createRecoveryFixture('submitted source');
try {
  const syntax = await f.write([semanticNode(0, f.source.textLength), semanticNode(1, f.source.textLength)]);
  const raw = f.store([syntax]);
  const refs = [0, 1].map(localId => ({ partitionId: f.partitionId, localId }));
  const scope = () => ({ repoRoot: f.root, generation: { ...f.generation } });
  const original = { ...scope(), refs: structuredClone(refs), fields: ['span'], include: [], limits: { records: 1 } };
  const captured = captureSemanticRequest(original, SEMANTIC_DETAIL_REQUEST_SCHEMA);
  assert.deepEqual(captured, original);
  assert.notEqual(captured.generation, original.generation);
  assert.notEqual(captured.refs[0], original.refs[0]);
  assert.ok(Object.isFrozen(captured) && Object.isFrozen(captured.refs) && Object.isFrozen(captured.refs[0]));
  assert.ok(Object.isFrozen(captured.generation) && Object.isFrozen(captured.limits));
  assert.equal(captureSemanticRequest(captured, SEMANTIC_DETAIL_REQUEST_SCHEMA), captured);
  assert.throws(() => { captured.refs[0].localId = 9; }, TypeError);

  const mutateDetail = () => {
    original.generation.baseBuildId = 'changed'; original.refs[0].localId = 9;
    original.fields.push('data'); original.include.push('providerEvidence'); original.limits.records = 128;
  };
  const detail = createSemanticDetailService();
  const first = await detail({ request: original, store: { ...raw,
    async getCoverage(...args) { mutateDetail(); return raw.getCoverage(...args); }
  } });
  assert.equal(first.records.length, 1);
  assert.equal(first.records[0].ref.localId, 0);
  assert.equal(Object.hasOwn(first.records[0], 'data'), false);
  assert.equal(first.providerEvidence, undefined);
  assert.deepEqual(first.generation, f.generation);
  assert.ok(first.cursor);
  const next = await detail({ store: raw, request: { ...captured, cursor: first.cursor } });
  assert.deepEqual(next.records.map(row => row.ref.localId), [1]);
  await assert.rejects(detail({ store: raw, request: { ...original, generation: { ...f.generation }, cursor: first.cursor } }),
    { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });

  const findRequest = { ...scope(), selector: { field: 'sourcePath', value: 'original.js',
    range: { start: 0, end: f.source.textLength } }, limits: { records: 1 } };
  const submittedFind = structuredClone(findRequest);
  let scopes = 0;
  const findStore = { ...raw,
    withReadScope(run) {
      scopes++; findRequest.selector.value = 'changed.js'; findRequest.generation.baseBuildId = 'changed';
      return raw.withReadScope(run);
    },
    async findOperations(selector, { offset, limit }) {
      assert.equal(selector.value, 'original.js');
      findRequest.selector.range.start = f.source.textLength + 1;
      const selected = refs.slice(offset, offset + limit);
      return { refs: selected, offset: offset + selected.length, done: offset + selected.length === refs.length };
    }
  };
  const find = createSemanticFindService();
  const found = await find({ store: findStore, request: findRequest });
  assert.equal(scopes, 1);
  assert.deepEqual(found.records.map(row => row.ref.localId), [0]);
  assert.deepEqual(found.generation, f.generation);
  assert.ok(found.cursor);
  const foundNext = await find({ store: findStore, request: { ...submittedFind, cursor: found.cursor } });
  assert.deepEqual(foundNext.records.map(row => row.ref.localId), [1]);

  const traceRequest = { ...scope(), seed: { ...refs[0] }, direction: 'downstream', kinds: ['flowsTo'],
    slot: { name: 'input', ordinal: 0 } };
  const traceStore = { ...raw,
    withReadScope(run) {
      traceRequest.seed.localId = 9; traceRequest.generation.baseBuildId = 'changed';
      traceRequest.direction = 'upstream'; traceRequest.kinds[0] = 'callTarget';
      return raw.withReadScope(run);
    },
    async getRelatedPage(parent, member) {
      assert.deepEqual(parent, refs[0]); assert.equal(member, 'semantic_operands');
      traceRequest.slot.ordinal = 1;
      return { rows: [{ parent, slot: 'argument', ordinal: 0, child: refs[1], flags: [] }], offset: 1, done: true };
    },
    async getNeighbors(ref, direction, kinds) {
      assert.deepEqual(ref, refs[1]); assert.equal(direction, 'downstream'); assert.deepEqual(kinds, ['flowsTo']);
      return { edges: [], offset: 0, done: true };
    }
  };
  const traced = await createSemanticTraceService()({ store: traceStore, request: traceRequest });
  assert.deepEqual(traced.records.map(row => row.ref.localId), [1]);
  assert.deepEqual(traced.generation, f.generation);
  assert.equal(traced.operands[0].ordinal, 0);

  // Publish a real symbolic family so public generation resolution and the
  // actual type reader participate, including mutations during store opening.
  const arena = createTypeIrArena({ contextKey: 'request-capture' }), root = arena.literal('submitted');
  const graph = createSymbolicTypeGraph(serializeTypeIrRoots(arena, [root]));
  const typeRef = { schemaVersion: 1, domain: 'finite-string', graphId: graph.graphId,
    contextKey: arena.contextKey, nodeId: root.id };
  const outDir = path.join(getBuildsRoot(f.root), f.generation.baseBuildId, 'index-code');
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  const registry = createArtifactPieceRegistry({ outDir }), writes = [];
  enqueueSymbolicTypeArtifacts({ state: { chunks: [], symbolicTypeGraphs: [graph] }, outDir,
    indexState: { buildId: f.generation.baseBuildId }, addPieceFile: registry.addPieceFile,
    declareArtifactFamily() {}, enqueueWrite: (name, run) => writes.push(run) });
  for (const write of writes) await write();
  await writePiecesManifest({ pieceEntries: registry.listPieceEntries(), outDir, mode: 'code',
    indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: f.generation.baseBuildId },
    abortSignal: new AbortController().signal });
  const typeRequest = { ...scope(), refs: [], limits: { bytes: 65536 }, typeQueries: [
    { ref: { ...typeRef }, operation: 'membership', value: 'submitted' },
    { ref: { ...typeRef }, operation: 'classify' }
  ] };
  const typeRunner = createSemanticDetailRunner({ async openTypeStore(options) {
    assert.deepEqual(options.generation, f.generation);
    assert.ok(Object.isFrozen(options.generation));
    typeRequest.generation.baseBuildId = 'changed'; typeRequest.limits.bytes = 1;
    typeRequest.typeQueries[0].value = 'changed'; typeRequest.typeQueries[0].ref.nodeId = 'tir1:' + '0'.repeat(64);
    typeRequest.typeQueries[1].operation = 'membership'; typeRequest.typeQueries.push({ invalid: true });
    return openPublishedSymbolicTypeStore(options);
  } });
  const typed = await typeRunner(typeRequest, { userConfig: {} });
  assert.equal(typed.typeResults.length, 2);
  assert.equal(typed.typeResults[0].contains, true);
  assert.deepEqual(typed.typeResults[1].witnesses, ['submitted']);
  assert.deepEqual(typed.generation, f.generation);
  assert.notEqual(typed.generation, typeRequest.generation);

  for (const mode of ['detail', 'find', 'trace']) {
    const request = mode === 'detail' ? { ...scope(), refs: [{ ...refs[0] }] }
      : mode === 'find' ? { ...scope(), selector: { field: 'astKind', value: 'Identifier' } }
        : { ...scope(), seed: { ...refs[0] }, direction: 'downstream', kinds: ['flowsTo'] };
    const runnerStore = { ...raw,
      async findOperations(selector) {
        assert.equal(selector.value, 'Identifier'); return { refs: [refs[0]], offset: 1, done: true };
      },
      async getNeighbors(ref, direction, kinds) {
        assert.deepEqual(ref, refs[0]); assert.equal(direction, 'downstream'); assert.deepEqual(kinds, ['flowsTo']);
        return { edges: [], offset: 0, done: true };
      }
    };
    let opened = 0, closed = 0;
    const openStore = async options => {
      opened++; assert.deepEqual(options.generation, f.generation);
      assert.ok(Object.isFrozen(options.generation));
      request.generation.baseBuildId = 'changed';
      if (mode === 'detail') request.refs[0].localId = 9;
      if (mode === 'find') request.selector.value = 'Changed';
      if (mode === 'trace') { request.direction = 'upstream'; request.seed.localId = 9; request.kinds[0] = 'callTarget'; }
      return { store: runnerStore, close: () => { closed++; } };
    };
    const create = mode === 'detail' ? createSemanticDetailRunner : mode === 'find' ? createSemanticFindRunner : createSemanticTraceRunner;
    const result = await create({ openStore })(request, { userConfig: {} });
    assert.equal(opened, 1); assert.equal(closed, 1, 'every runner settles the store borrowed for this request');
    assert.deepEqual(result.records.map(row => row.ref.localId), [0]);
    assert.deepEqual(result.generation, f.generation);
  }

  const valid = { ...scope(), refs: [refs[0]] };
  const contractError = { code: 'ERR_SEMANTIC_QUERY_CONTRACT' };
  let getterCalls = 0;
  for (const invalid of [
    { ...valid, unknown: true }, { ...valid, refs: Array(1) },
    { ...valid, refs: Object.assign([refs[0]], { extra: true }) },
    { ...valid, refs: [{ ...refs[0], [Symbol('extra')]: true }] },
    { ...valid, generation: new Date() }, { ...valid, generation: undefined },
    { ...valid, get generation() { getterCalls++; return f.generation; } }
  ]) assert.throws(() => captureSemanticRequest(invalid, SEMANTIC_DETAIL_REQUEST_SCHEMA), contractError);
  assert.equal(getterCalls, 0, 'capture never invokes request accessors');
  const optional = { ...valid, cursor: undefined, fields: undefined, include: undefined, typeQueries: undefined,
    limits: { records: undefined, bytes: undefined, rows: undefined, workMs: undefined } };
  assertSemanticQuery('detailRequest', optional);
  assert.deepEqual(captureSemanticRequest(optional, SEMANTIC_DETAIL_REQUEST_SCHEMA), { ...valid, limits: {} });
  const omittedPage = await createSemanticDetailService()({ store: raw, request: optional });
  assert.deepEqual(omittedPage.records.map(row => row.ref.localId), [0]);
  const findOptional = { ...submittedFind, cursor: undefined, backend: undefined, compareTo: undefined,
    limits: { records: 1, bytes: undefined, workMs: undefined } };
  assertSemanticFind('request', findOptional);
  const findCaptured = captureSemanticRequest(findOptional, SEMANTIC_FIND_REQUEST_SCHEMA);
  assert.equal(Object.hasOwn(findCaptured, 'cursor'), false);
  assert.deepEqual(findCaptured.limits, { records: 1 });
  assert.equal((await find({ store: findStore, request: findOptional })).records[0].ref.localId, 0);
  for (const invalidFind of [
    { ...submittedFind, unknown: true }, { ...scope(), selector: { field: 'astKind' } },
    { ...scope(), selector: { field: 'astKind', value: 'Identifier', range: { start: 0, end: 1 } } }
  ]) {
    await assert.rejects(createSemanticFindService()({ store: raw, request: invalidFind }), error =>
      error.code === 'ERR_SEMANTIC_QUERY_CONTRACT' && classifySemanticDetailError(error).status === 400,
    'capture and canonical find validation classify invalid requests consistently');
  }
  const cycle = { ...valid }; cycle.refs = [cycle];
  assert.throws(() => captureSemanticRequest(cycle, SEMANTIC_DETAIL_REQUEST_SCHEMA), contractError);
  const inspection = Object.freeze({ cacheOwnershipPending: true, cacheOwnershipReleased: () => false });
  const proxy = new Proxy(valid, { ownKeys() { throw inspection; } });
  assert.throws(() => captureSemanticRequest(proxy, SEMANTIC_DETAIL_REQUEST_SCHEMA), error => error === inspection,
    'reflection failure preserves the exact original observation');
  const maximum = captureSemanticRequest({ ...valid, refs: Array(16384).fill(refs[0]) }, SEMANTIC_DETAIL_REQUEST_SCHEMA);
  assert.equal(maximum.refs.length, 16384);
  assertSemanticQuery('detailRequest', maximum);
  assert.throws(() => captureSemanticRequest({ ...valid, refs: Array(16385).fill(refs[0]) }, SEMANTIC_DETAIL_REQUEST_SCHEMA), contractError);
  const queries = Array(16).fill({ ref: typeRef, operation: 'classify' });
  assertSemanticQuery('detailRequest', captureSemanticRequest({ ...valid, typeQueries: queries }, SEMANTIC_DETAIL_REQUEST_SCHEMA));
  assert.throws(() => captureSemanticRequest({ ...valid, typeQueries: [...queries, queries[0]] }, SEMANTIC_DETAIL_REQUEST_SCHEMA), contractError);
  assert.throws(() => captureSemanticRequest({ ...valid, fields: ['span', 'scope', 'data', 'span'] }, SEMANTIC_DETAIL_REQUEST_SCHEMA), contractError);
  assert.throws(() => captureSemanticRequest({ ...submittedFind, selector: { typeExpression: {
    expression: 'string', match: 'exact-expression', sources: ['compiler', 'declared', 'compiler'], roles: ['local']
  } } }, SEMANTIC_FIND_REQUEST_SCHEMA), contractError);
  const traceCaptured = captureSemanticRequest({ ...scope(), seed: refs[0], direction: 'downstream',
    kinds: ['flowsTo', 'returns'] }, SEMANTIC_TRACE_REQUEST_SCHEMA);
  assert.ok(Object.isFrozen(traceCaptured.kinds));
  const malformed = { ...valid, refs: Array(16385).fill(refs[0]) };
  await assert.rejects(createSemanticDetailService()({ store: raw, request: malformed }), contractError);
  console.log('Semantic requests retain submitted generation, selectors, refs and type operations across callbacks');
} finally { await f.cleanup(); }
