import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createSourceReferenceReader, attachSemanticSourceReferences } from '../../../src/semantic/source-references.js';
import { createSemanticSourceSnapshot, createWasmSourceSnapshot } from '../../../src/index/semantic/source.js';
import { projectExplainEnrichment } from '../../../src/semantic/explain-enrichment.js';

const source = createSemanticSourceSnapshot({ bytes: Buffer.from('\uFEFFa\r\n\u{1F642}'),
  repositoryNamespace: 'fixture', path: 'original.js', language: 'javascript' }).manifest;
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 0 };
const record = { ref, span: [1, source.textLength] };
const reader = (headers, sourceUnitId = source.sourceUnitId) => createSourceReferenceReader({
  sourceUnitForPartition: () => sourceUnitId,
  iterateRows: async function* () { yield* headers; }
});
assert.deepEqual(await reader([source])(record), { ref, sourceUnitId: source.sourceUnitId,
  sourceHash: source.byteHash, path: source.path, coordinateUnit: 'utf16' });
for (const headers of [[], [source, source]]) {
  await assert.rejects(reader(headers)(record), { code: 'ERR_SEMANTIC_INTEGRITY' });
}
await assert.rejects(reader([source], 'su1:' + 'b'.repeat(64))(record), { code: 'ERR_SEMANTIC_INTEGRITY' });
await assert.rejects(reader([source])( { ...record, span: [0, source.textLength + 1] }),
  { code: 'ERR_SEMANTIC_INTEGRITY' });
await assert.rejects(reader([source], null)(record), { code: 'ERR_SEMANTIC_INTEGRITY' });
const mapped = createSemanticSourceSnapshot({ bytes: Buffer.from('a'), repositoryNamespace: 'fixture',
  path: 'generated.js', language: 'javascript', mapping: { identity: 'c'.repeat(64),
    parentSourceUnitId: source.sourceUnitId, mapRef: 'mapping.json', quality: 'exact' } }).manifest;
assert.equal(await reader([mapped], mapped.sourceUnitId)({ ...record, span: [0, 1] }), null,
  'an exact map identity still requires an actual coordinate adapter');
const generation = { baseBuildId: 'fixture', semanticRevision: 0 };
const explainMapped = await projectExplainEnrichment({
  store: { iterateRows: async function* () { yield mapped; } },
  manifest: { generation, completedTasks: [], partitions: [{ partitionId: ref.partitionId,
    sourceUnitId: mapped.sourceUnitId }] }, request: { generation },
  result: { records: [{ ...record, span: [0, 1] }], frontier: [] }
});
assert.deepEqual(explainMapped.sourceRefs, [], 'explain shares direct source coordinate refusal');
const binary = createWasmSourceSnapshot({ bytes: Buffer.from([0, 97, 115, 109]),
  repositoryNamespace: 'fixture', path: 'module.wasm' });
assert.equal((await reader([binary], binary.sourceUnitId)({ ...record, span: [0, 4] })).coordinateUnit, 'byte');
await assert.rejects(reader([binary], binary.sourceUnitId)({ ...record, span: [0, 5] }),
  { code: 'ERR_SEMANTIC_INTEGRITY' });
assert.equal(await reader([])({ ref, span: null }), null);
const result = () => ({ records: [record], warnings: [], cursor: null });
const limits = { workMs: 250, bytes: 4096 };
const expired = result();
let reads = 0;
await attachSemanticSourceReferences({ store: { getSourceReference: async () => { reads++; } },
  result: expired, began: performance.now() - 251, limits });
assert.equal(reads, 0, 'source metadata never starts a second work allowance');
assert.deepEqual(expired.sourceRefs, []);
const corrupt = Object.assign(new Error('corrupt retained source'), { code: 'ERR_SEMANTIC_INTEGRITY' });
await assert.rejects(attachSemanticSourceReferences({ store: { getSourceReference: async () => { throw corrupt; } },
  result: result(), began: performance.now(), limits }), error => error === corrupt);
await assert.rejects(attachSemanticSourceReferences({ store: { getSourceReference: async () => ({
  ref: { ...ref, localId: 1 }, sourceUnitId: source.sourceUnitId,
  sourceHash: source.byteHash, path: source.path, coordinateUnit: 'utf16'
}) }, result: result(), began: performance.now(), limits }), { code: 'ERR_SEMANTIC_INTEGRITY' });
const controller = new AbortController();
controller.abort();
await assert.rejects(attachSemanticSourceReferences({ store: { getSourceReference: reader([source]) },
  result: result(), began: performance.now(), limits, signal: controller.signal }), { name: 'AbortError' });
const bounded = result();
const byteLimit = Buffer.byteLength(JSON.stringify({ ...bounded, sourceRefs: [] })) + 180;
await attachSemanticSourceReferences({ store: { getSourceReference: reader([source]) },
  result: bounded, began: performance.now(), limits: { ...limits, bytes: byteLimit } });
assert.deepEqual(bounded.sourceRefs, []);
assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= byteLimit);
console.log('Semantic source reference admission preserves authority, cancellation and page limits');
