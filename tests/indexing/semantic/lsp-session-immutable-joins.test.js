import assert from 'node:assert/strict';
import path from 'node:path';
import { createLspSourceIndex } from '../../../src/index/semantic/lsp-source-index.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
const repoRoot = path.resolve('fixture-lsp-root');
const item = (id, file, declarations = []) => ({ source: { sourceUnitId: id, byteHash: `hash-${id}`, path: file }, text: 'same text', declarations });
const ordinary = item('parent-a', 'a.ts', Array.from({ length: 4000 }, (_, index) => ({ span: [index * 10, index * 10 + 7], ref: index })));
const other = item('parent-b', 'b.ts');
const segment = (id, parent, start) => ({ ...item(id, 'embedded.ts'), source: { ...item(id, 'embedded.ts').source, mapping: { parentSourceUnitId: parent } },
  sourceMap: { segmentUid: 'same-segment', parentStart: start, parentEnd: start + 10 } });
const a = segment('embedded-a', 'parent-a', 20), b = segment('embedded-b', 'parent-b', 20);
const inventory = new Map([ordinary, other, a, b].map(value => [value.source.sourceUnitId, value]));
const index = createLspSourceIndex({ inventory, repoRoot });
assert.equal(index.digest, semanticHash('semantic.lsp-sources.v1', [...inventory.values()]
  .map(value => ({ sourceUnitId: value.source.sourceUnitId, byteHash: value.source.byteHash }))
  .sort((left, right) => left.sourceUnitId.localeCompare(right.sourceUnitId))));
for (let pass = 0; pass < 100; pass++) {
  assert.equal(index.itemForDocument({ virtualPath: 'a.ts' }), ordinary);
  assert.equal(index.itemForPath(path.join(repoRoot, 'a.ts')), ordinary);
  assert.equal(index.itemForDocument({ virtualPath: 'virtual', containerPath: 'a.ts', segmentUid: 'same-segment', segmentRange: { start: 20, end: 30 }, text: 'same text' }), a);
  assert.equal(index.itemForDocument({ virtualPath: 'virtual', containerPath: 'b.ts', segmentUid: 'same-segment', segmentRange: { start: 20, end: 30 }, text: 'same text' }), b);
}
assert.equal(index.stats.inventoryDigests, 1);
assert.equal(index.itemForDocument({ virtualPath: 'virtual', containerPath: 'a.ts', segmentUid: 'same-segment', segmentRange: { start: 20, end: 31 }, text: 'same text' }), undefined);
assert.equal(index.itemForDocument({ virtualPath: 'virtual', containerPath: 'a.ts', segmentUid: 'same-segment', segmentRange: { start: 20, end: 30 }, text: 'different' }), undefined);
assert.deepEqual(index.containingDeclarations(ordinary, [20001, 20004]).map(value => value.ref), [2000]);
assert.ok(index.stats.declarationNodesVisited < 64, 'sparse span joins do not scan the declaration inventory');
const overlapping = item('nested', 'nested.ts', [{ span: [0, 100], ref: 'outer' }, { span: [10, 20], ref: 'inner' }, { span: [11, 19], ref: 'nested' }]);
assert.equal(index.containingDeclarations(overlapping, [12, 13]).length, 2, 'retain ambiguity instead of selecting the smallest declaration');
const windows = createLspSourceIndex({ inventory, repoRoot, platform: 'win32' });
assert.equal(windows.itemForPath(path.join(repoRoot, 'A.TS')), ordinary);
assert.equal(index.itemForDocument({ virtualPath: 'b.ts', semanticSourceUnitId: ordinary.source.sourceUnitId,
  text: ordinary.text }), undefined, 'equal text cannot move a pinned source ID to another container');
assert.equal(index.itemForDocument({ virtualPath: 'a.ts', semanticSourceUnitId: a.source.sourceUnitId,
  text: ordinary.text }), undefined, 'an embedded source ID cannot fall back to its plain parent');
const embeddedDoc = { virtualPath: 'virtual', containerPath: 'a.ts', segmentUid: 'same-segment',
  segmentRange: { start: 20, end: 30 }, text: 'same text' };
assert.equal(index.itemForDocument({ ...embeddedDoc, semanticSourceUnitId: b.source.sourceUnitId }), undefined,
  'a supplied source ID must match the exact embedded route');
const competing = segment('embedded-competing', 'parent-a', 20);
const ambiguous = createLspSourceIndex({ inventory: new Map([...inventory, [competing.source.sourceUnitId, competing]]), repoRoot });
assert.throws(() => ambiguous.itemForDocument(embeddedDoc), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
assert.equal(ambiguous.itemForDocument({ ...embeddedDoc, semanticSourceUnitId: a.source.sourceUnitId }), a,
  'an exact source ID may disambiguate equal segment text');
const samePath = item('different-source', 'a.ts');
assert.throws(() => createLspSourceIndex({ inventory: new Map([...inventory, [samePath.source.sourceUnitId, samePath]]), repoRoot }),
  { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
console.log('LSP immutable inventory digest, full embedded identity and bounded declaration cardinality');
