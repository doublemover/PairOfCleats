import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { resolveRetainedCanonicalLexicalBinding, materializeRetainedLexicalBindingLens } from '../../../src/semantic/retained-lexical-binding.js';

// Authored only: real canonical writer/store -> lexical model -> existing source lens.
const f = await createRecoveryFixture('x { x x x; }');
try {
  const ref = localId => ({ partitionId: f.partitionId, localId });
  const node = (id, kind, span, scope, data) => ({ family: 'node', row: { id, kind, span, scope, data } });
  const declaration = (id, span, scope) => node(id, 'declaration', span, scope,
    { nameId: 0, declarationKind: 'fixture-value', flags: [], initializer: null, typeSyntax: null });
  const partition = await f.write([
    node(0, 'scope', [0, f.source.textLength], null, { scopeKind: 'module', parent: null, owner: null }),
    node(1, 'scope', [2, f.source.textLength], ref(0), { scopeKind: 'block', parent: ref(0), owner: null }),
    declaration(2, [0, 1], ref(0)), declaration(3, [4, 5], ref(1)), declaration(4, [6, 7], ref(1)),
    node(5, 'occurrence', [8, 9], ref(1), { nameId: 0, roles: ['reference'], expression: null, flags: [] }),
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'x' } }
  ]);
  const store = f.store([partition]), profile = { id: 'lexical-local-first-v1', version: 1, namespaces: ['value', 'type'] };
  const closures = new Map([0, 1].map(id => [canonicalSemanticJson(ref(id)), {
    declarationsClosed: true, parentClosed: true, receiptId: 'fixture-closed-' + id, unsupported: [] }]));
  const annotations = new Map([2, 3, 4].map(id => [canonicalSemanticJson(ref(id)), { namespace: id === 4 ? 'type' : 'value', datumKey: 'x', access: 'allowed' }]));
  const request = { store, world: { generation: f.generation, repositoryNamespace: f.root, contextKey: 'fixture-lexical' },
    profile, closures, annotations, query: { occurrence: ref(5), startScope: ref(1), namespace: 'value', datumKey: 'x' } };
  await fs.writeFile(f.original, 'changed worktree source');
  const answer = await resolveRetainedCanonicalLexicalBinding(request);
  assert.equal(answer.status, 'resolved');
  assert.deepEqual(answer.targets, [ref(3)]);
  assert.equal(answer.projection.sourceReadBytes, f.bytes.length);
  assert.equal(answer.projection.scannedRows, 6);
  assert.equal(answer.projection.profileAnnotations, 'trusted-upstream-admission');
  assert.equal(answer.projection.sourceLanguageClosure, 'not-implied');
  assert.deepEqual(answer.sourceWitnesses[1], { ref: ref(3), sourceUnitId: f.source.sourceUnitId,
    sourceHash: f.source.byteHash, path: 'original.js', coordinateUnit: 'utf16', span: [4, 5] });
  const { lens } = await materializeRetainedLexicalBindingLens({ ...request, taskId: 'explain-reference',
    retainedResult: { ownerHandle: 'fixture-pinned-generation', enumeration: 'partial' } });
  assert.deepEqual(lens.facets.map(facet => facet.text), ['x', 'x']);
  assert.equal(lens.facets[1].qualification.sourceLanguageClosure, 'not-implied');
  assert.equal(lens.facets[1].editAuthority, 'not-granted');
  const ambiguousAnnotations = new Map(annotations);
  ambiguousAnnotations.set(canonicalSemanticJson(ref(4)), { namespace: 'value', datumKey: 'x', access: 'allowed' });
  const overflow = await materializeRetainedLexicalBindingLens({ ...request, annotations: ambiguousAnnotations, taskId: 'explain-reference', maxFacets: 2,
    retainedResult: { ownerHandle: 'fixture-pinned-generation', enumeration: 'partial' } });
  assert.equal(overflow.answer.status, 'ambiguous'); assert.equal(overflow.answer.targets.length, 2);
  assert.equal(overflow.lens.status, 'mandatoryOverflow', 'presentation cannot omit an ambiguity candidate and imply unique admitted navigation');
  const mutableAnnotations = new Map([...annotations].map(([id, value]) => [id, structuredClone(value)]));
  const mutatingStore = { ...store, async getRecords(...args) {
    mutableAnnotations.get(canonicalSemanticJson(ref(3))).datumKey = 'changed-during-source-read';
    return store.getRecords(...args);
  } };
  assert.deepEqual((await resolveRetainedCanonicalLexicalBinding({ ...request, store: mutatingStore, annotations: mutableAnnotations })).targets,
    [ref(3)], 'upstream profile inputs are snapshotted before awaited retained reads');
  await assert.rejects(resolveRetainedCanonicalLexicalBinding({ ...request, query: { ...request.query, startScope: ref(0) } }),
    { code: 'ERR_BINDING_QUERY_CONTRACT' });
  await assert.rejects(resolveRetainedCanonicalLexicalBinding({ ...request, query: { ...request.query, occurrence: ref(99) } }),
    { code: 'ERR_BINDING_QUERY_CONTRACT' });
  await assert.rejects(resolveRetainedCanonicalLexicalBinding({ ...request, world: { ...request.world, sourceSnapshotId: 'unrelated-source' } }),
    { code: 'ERR_BINDING_QUERY_CONTRACT' });
  await assert.rejects(resolveRetainedCanonicalLexicalBinding({ ...request,
    world: { ...request.world, generation: { ...f.generation, baseBuildId: 'other-build' } } }), { code: 'ERR_BINDING_QUERY_CONTRACT' });
  const prefix = await resolveRetainedCanonicalLexicalBinding({ ...request, maxRows: 1 });
  assert.equal(prefix.status, 'unknown'); assert.equal(prefix.completeInProfile, false); assert.deepEqual(prefix.targets, []);
  assert.ok(prefix.frontier.some(frontier => frontier.reason === 'retained-input-row-budget'));
  assert.equal((await resolveRetainedCanonicalLexicalBinding({ ...request, maxRows: 6 })).completeInProfile, false,
    'exact allowance does not charge an extra lookahead to assert inventory closure');
  const oversized = new Map(annotations); oversized.set(canonicalSemanticJson(ref(3)), { namespace: 'value', datumKey: 'x'.repeat(2048), access: 'allowed' });
  await assert.rejects(resolveRetainedCanonicalLexicalBinding({ ...request, annotations: oversized, maxMetadataBytes: 1024 }),
    { code: 'ERR_BINDING_QUERY_CONTRACT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveRetainedCanonicalLexicalBinding({ ...request, signal: controller.signal }), { name: 'AbortError' });
  await fs.writeFile(path.join(f.stagingRoot, 'semantic-sources', f.source.byteHash + '.utf8'), Buffer.from('z'.repeat(f.bytes.length)));
  await assert.rejects(resolveRetainedCanonicalLexicalBinding(request), { code: 'ERR_FILE_INTEGRITY' });
} finally { await f.cleanup(); }
console.log('retained canonical lexical query and exact-source lens consumer controls passed');
