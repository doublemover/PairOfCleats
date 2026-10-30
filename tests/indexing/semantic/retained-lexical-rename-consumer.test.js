import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { resolveRetainedCanonicalLexicalBinding } from '../../../src/semantic/retained-lexical-binding.js';
import { proposeRetainedCanonicalLexicalRename } from '../../../src/semantic/retained-lexical-rename.js';

// Authored only: canonical writer/store -> shared capture -> existing inert planner.
const f = await createRecoveryFixture('x x y');
try {
  const key = canonicalSemanticJson, ref = localId => ({ partitionId: f.partitionId, localId });
  const node = (id, kind, span, scope, data) => ({ family: 'node', row: { id, kind, span, scope, data } });
  const occurrence = (id, span, nameId, roles) => node(id, 'occurrence', span, ref(0),
    { nameId, roles, expression: null, flags: [] });
  const partition = await f.write([
    node(0, 'scope', [0, 5], null, { scopeKind: 'module', parent: null, owner: null }),
    node(1, 'declaration', [0, 1], ref(0), { nameId: 0, declarationKind: 'fixture-value', flags: [], initializer: null, typeSyntax: null }),
    occurrence(2, [2, 3], 0, ['reference']), occurrence(3, [4, 5], 1, ['reference']),
    occurrence(4, [0, 1], 0, ['definition', 'write']),
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'x' } },
    { family: 'lookup', row: { kind: 'name', id: 1, value: 'y' } }
  ]);
  const store = f.store([partition]);
  const world = { generation: f.generation, repositoryNamespace: f.root, contextKey: 'fixture-rename' };
  const profile = { id: 'lexical-local-first-v1', version: 1, namespaces: ['value'] };
  const closures = new Map([[key(ref(0)), { declarationsClosed: true, parentClosed: true, receiptId: 'fixture-closed', unsupported: [] }]]);
  const annotations = new Map([[key(ref(1)), { namespace: 'value', datumKey: 'x', access: 'allowed' }]]);
  const occurrenceAnnotations = new Map([[key(ref(2)), { namespace: 'value', datumKey: 'x' }],
    [key(ref(3)), { namespace: 'value', datumKey: 'y' }]]);
  const binding = await resolveRetainedCanonicalLexicalBinding({ store, world, profile, closures, annotations,
    query: { occurrence: ref(2), startScope: ref(0), namespace: 'value', datumKey: 'x' } });
  const universe = occurrenceMap => ({ state: 'complete-in-model', receiptId: 'fixture-upstream-reference-closure',
    world: binding.world, partitionId: f.partitionId, inputInventoryHash: binding.projection.inputInventoryHash,
    profileHash: binding.projection.profileHash, occurrenceAnnotationsHash: semanticHash('semantic.retained-lexical-occurrence-profile.v1',
      [...occurrenceMap].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) });
  const request = { store, world, profile, closures, annotations, target: ref(1), newName: 'z',
    occurrenceAnnotations, referenceUniverse: universe(occurrenceAnnotations) };
  await fs.writeFile(f.original, 'changed live worktree');
  let sourceCaptures = 0;
  const countedStore = { ...store, iterateRows: (partitionId, family, options) => {
    if (family === 'semantic_sources') sourceCaptures++;
    return store.iterateRows(partitionId, family, options);
  } };
  const plan = await proposeRetainedCanonicalLexicalRename({ ...request, store: countedStore });
  assert.equal(sourceCaptures, 1, 'all forward/preservation checks share one retained source capture');
  assert.equal(plan.overlays[0].text, 'z z y');
  assert.equal(plan.bindingPreservation, 'preserved-in-model');
  assert.deepEqual(plan.lockedTarget, ref(1));
  assert.equal(plan.preservation.length, 2, 'untouched failed lookups remain in the preservation set');
  assert.equal(plan.preservation.find(row => row.occurrence.localId === 3).before.status, 'missing');
  assert.equal(plan.projection.definitionOccurrences, 1, 'definition-only source occurrences are not duplicated as reference edits');
  assert.equal(plan.edits.length, 2);
  assert.equal(plan.projection.sourceReadBytes, f.bytes.length);
  assert.equal(plan.projection.referenceUniverse, 'trusted-upstream-admission-bound-to-capture');
  assert.equal(plan.syntaxValidity, 'not-checked'); assert.equal(plan.nativeValidation, 'not-run');
  assert.equal(plan.behaviorPreservation, 'not-claimed'); assert.equal(plan.applySupported, false);
  assert.equal(await fs.readFile(f.original, 'utf8'), 'changed live worktree', 'the proposal never writes the live source');
  const capture = await proposeRetainedCanonicalLexicalRename({ ...request, newName: 'y' });
  assert.equal(capture.bindingPreservation, 'refuted-in-model');
  assert.equal(capture.preservation.find(row => row.occurrence.localId === 3).status, 'changed', 'a newly captured formerly missing reference refutes binding preservation');
  for (const receipt of [{ state: 'complete-in-model', receiptId: 'unbound' },
    { ...request.referenceUniverse, profileHash: 'wrong-profile' },
    { ...request.referenceUniverse, inputInventoryHash: 'wrong-inventory' }]) {
    const partial = await proposeRetainedCanonicalLexicalRename({ ...request, referenceUniverse: receipt });
    assert.equal(partial.bindingPreservation, 'unknown');
    assert.ok(partial.frontier.some(row => row.reason === 'retained-reference-universe-unqualified'));
  }
  const incompleteMap = new Map([[key(ref(2)), occurrenceAnnotations.get(key(ref(2)))]]);
  const missing = await proposeRetainedCanonicalLexicalRename({ ...request, occurrenceAnnotations: incompleteMap, referenceUniverse: universe(incompleteMap) });
  assert.equal(missing.bindingPreservation, 'unknown');
  assert.equal(missing.projection.unqualifiedOccurrences, 1);
  assert.ok(missing.frontier.some(row => row.reason === 'retained-reference-profile-unavailable'));
  for (const maxRows of [2, 5]) {
    const prefix = await proposeRetainedCanonicalLexicalRename({ ...request, maxRows });
    assert.equal(prefix.bindingPreservation, 'unknown');
    assert.ok(prefix.frontier.some(row => row.reason === 'retained-input-row-budget'));
  }
  const mutableMap = new Map([...occurrenceAnnotations].map(([id, annotation]) => [id, structuredClone(annotation)]));
  const mutableTarget = ref(1), mutableUniverse = structuredClone(request.referenceUniverse);
  const pinned = await proposeRetainedCanonicalLexicalRename({ ...request, target: mutableTarget, occurrenceAnnotations: mutableMap,
    referenceUniverse: mutableUniverse, store: { ...store, iterateRows: (partitionId, family, options) => {
      mutableMap.get(key(ref(2))).datumKey = 'wrong'; mutableTarget.localId = 99; mutableUniverse.receiptId = 'changed';
      return store.iterateRows(partitionId, family, options);
    } } });
  assert.equal(pinned.bindingPreservation, 'preserved-in-model', 'target, closure and occurrence profile are pinned before source reads yield');
  const bounded = await proposeRetainedCanonicalLexicalRename({ ...request, maxEvidenceBytes: 1024 });
  assert.equal(bounded.bindingPreservation, 'unknown'); assert.ok(bounded.retainedEvidenceBytes <= 1024);
  assert.ok(bounded.frontier.some(row => row.reason === 'evidence-byte-budget'));
  await assert.rejects(proposeRetainedCanonicalLexicalRename({ ...request, target: ref(99) }), { code: 'ERR_BINDING_QUERY_CONTRACT' });
  await assert.rejects(proposeRetainedCanonicalLexicalRename({ ...request, occurrenceAnnotations: new Map([[key(ref(1)), { namespace: 'value', datumKey: 'x' }]]) }),
    { code: 'ERR_BINDING_QUERY_CONTRACT' });
  await assert.rejects(proposeRetainedCanonicalLexicalRename({ ...request, world: { ...world, generation: { ...f.generation, baseBuildId: 'wrong' } } }),
    { code: 'ERR_BINDING_QUERY_CONTRACT' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(proposeRetainedCanonicalLexicalRename({ ...request, signal: controller.signal }), { name: 'AbortError' });
  await fs.writeFile(path.join(f.stagingRoot, 'semantic-sources', f.source.byteHash + '.utf8'), Buffer.from('q'.repeat(f.bytes.length)));
  await assert.rejects(proposeRetainedCanonicalLexicalRename(request), { code: 'ERR_FILE_INTEGRITY' });
} finally { await f.cleanup(); }
console.log('retained target-locked lexical rename and untouched-reference preservation controls passed');
