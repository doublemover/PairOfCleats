import assert from 'node:assert/strict';
import { resolveLexicalBinding, confirmLexicalDependencies } from '../../../src/index/semantic/bindings/lexical.js';
import { resolveCanonicalLexicalBinding } from '../../../src/semantic/lexical-binding.js';
import { stableStringify } from '../../../src/shared/stable-json.js';

const ref = localId => ({ partitionId: `sy1:${'a'.repeat(64)}`, localId });
const world = { generation: { baseBuildId: 'build', semanticRevision: 0 }, repositoryNamespace: 'repo',
  sourceSnapshotId: 'sources', contextKey: 'configured-build' };
const profile = { id: 'lexical-local-first-v1', version: 1, namespaces: ['value', 'type'] };
const scope = (id, parent) => ({ ref: ref(id), parent: parent == null ? null : ref(parent),
  declarationsClosed: true, parentClosed: true, closureReceiptId: `closed-${id}`, unsupported: [] });
const decl = (id, scopeId, extra = {}) => ({ ref: ref(id), scope: ref(scopeId), namespace: 'value', datumKey: 'x', access: 'allowed', ...extra });
const scopes = [scope(0, null), scope(1, 0)];
const query = { startScope: ref(1), occurrence: ref(99), namespace: 'value', datumKey: 'x' };
const run = (declarations, extra = {}) => resolveLexicalBinding({ world, profile, scopes, declarations, query, ...extra });
assert.deepEqual(run([decl(2, 0), decl(3, 1)]).targets, [ref(3)], 'nearest declaration shadows outer scope');
assert.equal(run([decl(2, 0), decl(3, 1, { access: 'denied' })]).status, 'inaccessible');
assert.deepEqual(run([decl(2, 0), decl(3, 1, { namespace: 'type' })]).targets, [ref(2)]);
assert.equal(run([decl(3, 1), decl(4, 1)]).status, 'ambiguous');
assert.equal(run([decl(3, 1, { access: 'unknown' })]).completeInProfile, false);
const missing = run([]);
assert.equal(missing.status, 'missing');
assert.equal(missing.dependencies.filter(row => row.kind === 'negative-lookup').length, 2);
assert.equal(confirmLexicalDependencies({ answer: missing, world, profile, scopes, declarations: [] }).state, 'valid');
assert.equal(confirmLexicalDependencies({ answer: missing, world, profile, scopes, declarations: [decl(2, 0)] }).state, 'invalid');
assert.equal(confirmLexicalDependencies({ answer: missing, world: { ...world, contextKey: 'new-flags' }, profile, scopes, declarations: [] }).state, 'unknown');
const openScopes = structuredClone(scopes);
openScopes[1].declarationsClosed = false;
assert.equal(run([], { scopes: openScopes }).status, 'unknown', 'partial graph never proves absence');
assert.equal(run([decl(3, 1)], { scopes: openScopes }).completeInProfile, false, 'partial local inventory cannot exclude ambiguity');
assert.equal(run([], { maxVisits: 1 }).frontier[0].reason, 'work-budget');
assert.equal(run([decl(3, 1), decl(4, 1)], { maxCandidates: 1 }).frontier[0].reason, 'candidate-budget');
assert.equal(run([decl(2, 0)], { maxWitnessRefs: 1 }).frontier[0].reason, 'witness-budget');
const controller = new AbortController(); controller.abort();
assert.equal(run([], { signal: controller.signal }).frontier[0].reason, 'cancelled');
const cycle = [scope(0, 1), scope(1, 0)];
assert.equal(run([], { scopes: cycle }).frontier[0].reason, 'lexical-cycle');
const unsupported = structuredClone(scopes); unsupported[1].unsupported = ['conditional-exports'];
assert.equal(run([], { scopes: unsupported }).status, 'unknown');

const records = [
  { id: 0, kind: 'scope', span: [0, 20], scope: null, data: { scopeKind: 'module', parent: null, owner: null } },
  { id: 1, kind: 'scope', span: [5, 20], scope: ref(0), data: { scopeKind: 'function', parent: ref(0), owner: null } },
  { id: 2, kind: 'declaration', span: [0, 4], scope: ref(0), data: { nameId: 0, declarationKind: 'variable', flags: [], initializer: null, typeSyntax: null } }
];
const closures = new Map(scopes.map(row => [stableStringify(row.ref), { declarationsClosed: true,
  parentClosed: true, receiptId: row.closureReceiptId, unsupported: [] }]));
const projected = resolveCanonicalLexicalBinding({ partitions: [{ partitionId: ref(0).partitionId, records }],
  closures, annotations: new Map([[stableStringify(ref(2)), { namespace: 'value', datumKey: 'x', access: 'allowed' }]]), world, profile, query });
assert.deepEqual(projected.targets, [ref(2)]);
assert.equal(projected.wellFormed, 'not-assessed', 'a valid lookup does not prove absence of other diagnostics');
console.log('closed lexical binding reference contract passed');
