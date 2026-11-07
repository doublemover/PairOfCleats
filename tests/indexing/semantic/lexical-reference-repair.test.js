import assert from 'node:assert/strict';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { proposeLexicalRename } from '../../../src/index/semantic/reference-repair/lexical-rename.js';

const ref = localId => ({ partitionId: `sy1:${'a'.repeat(64)}`, localId });
const source = createSemanticSourceSnapshot({ bytes: Buffer.from('x x y'), repositoryNamespace: 'repo', path: 'a.js', language: 'javascript' });
const site = (start, end) => ({ sourceUnitId: source.manifest.sourceUnitId, span: [start, end] });
const args = {
  world: { generation: { baseBuildId: 'base', semanticRevision: 0 }, repositoryNamespace: 'repo', sourceSnapshotId: 'base-sources', contextKey: 'build-context' },
  profile: { id: 'lexical-local-first-v1', version: 1, namespaces: ['value'] },
  scopes: [{ ref: ref(0), parent: null, declarationsClosed: true, parentClosed: true, closureReceiptId: 'closed', unsupported: [] }],
  declarations: [{ ref: ref(1), scope: ref(0), namespace: 'value', datumKey: 'x', access: 'allowed' }],
  sources: [source], target: ref(1), declarationSite: site(0, 1), newName: 'z',
  occurrences: [
    { query: { occurrence: ref(2), startScope: ref(0), namespace: 'value', datumKey: 'x' }, site: site(2, 3) },
    { query: { occurrence: ref(3), startScope: ref(0), namespace: 'value', datumKey: 'y' }, site: site(4, 5) }
  ], referenceUniverse: { state: 'complete-in-model', receiptId: 'closed-references' }
};
const plan = proposeLexicalRename(args);
assert.equal(plan.bindingPreservation, 'preserved-in-model');
assert.equal(plan.overlays[0].text, 'z z y');
assert.equal(source.text, 'x x y', 'source owner is immutable and no edit is applied');
assert.equal(plan.syntaxValidity, 'not-checked');
assert.equal(plan.nativeValidation, 'not-run');
assert.equal(plan.applySupported, false);
assert.notEqual(plan.overlays[0].manifest.sourceUnitId, source.manifest.sourceUnitId);
const capture = proposeLexicalRename({ ...args, newName: 'y' });
assert.equal(capture.bindingPreservation, 'refuted-in-model', 'rename capturing an untouched formerly free reference is rejected');
assert.equal(capture.preservation.find(row => row.occurrence.localId === 3).status, 'changed');
const partial = proposeLexicalRename({ ...args, referenceUniverse: { state: 'partial' } });
assert.equal(partial.bindingPreservation, 'unknown');
assert.ok(partial.frontier.some(row => row.reason === 'affected-reference-universe-incomplete'));
const bounded = proposeLexicalRename({ ...args, maxQueries: 1 });
assert.equal(bounded.bindingPreservation, 'unknown');
assert.ok(bounded.frontier.some(row => row.reason === 'query-budget'));
const evidenceBounded = proposeLexicalRename({ ...args, maxEvidenceBytes: 1024 });
assert.equal(evidenceBounded.bindingPreservation, 'unknown');
assert.ok(evidenceBounded.frontier.some(row => row.reason === 'evidence-byte-budget'));
assert.ok(evidenceBounded.retainedEvidenceBytes <= 1024, 'retained resolution evidence has an allowance separate from source overlays');
const controller = new AbortController(); controller.abort();
assert.equal(proposeLexicalRename({ ...args, signal: controller.signal }).bindingPreservation, 'unknown');
assert.throws(() => proposeLexicalRename({ ...args, declarationSite: site(1, 2) }), /spelling/);
assert.throws(() => proposeLexicalRename({ ...args, target: ref(999) }), /target declaration/);
assert.throws(() => proposeLexicalRename({ ...args, newName: 'x; run()' }), /lexical identifier/);
const staleSource = { ...source, manifest: { ...source.manifest, byteHash: 'b'.repeat(64) } };
assert.throws(() => proposeLexicalRename({ ...args, sources: [staleSource] }), /Stale/);
let sourceGetterCalls = 0;
const accessorSource = { manifest: source.manifest, get sourceCapability() { sourceGetterCalls++; return source.sourceCapability; } };
assert.throws(() => proposeLexicalRename({ ...args, sources: [accessorSource] }), /Stale/);
assert.equal(sourceGetterCalls, 0, 'the existing source admission owner rejects accessors without invocation');
console.log('target-locked lexical source overlay contract passed');
