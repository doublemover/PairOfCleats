import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareSemanticdbReferenceEvidence, SEMANTICDB_PROVIDER_DECLARATION } from '../../../src/index/tooling/semanticdb-reference-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

// UNVALIDATED: application-owned wire fixtures, synthetic producing receipts and
// parser inventories. No Scala compiler, Metals, BSP or actual build is invoked.
const varint = value => {
  const bytes = [];
  do { const digit = value & 127; value = Math.floor(value / 128); bytes.push(digit | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
};
const number = (field, value) => Buffer.concat([varint(field * 8), varint(value)]);
const packed = (field, bytes) => Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
const string = (field, value) => packed(field, Buffer.from(value));
const message = (...parts) => Buffer.concat(parts);
const range = (line, start, end) => message(number(1, line), number(2, start), number(3, line), number(4, end));
const occurrence = (line, start, end, symbol, role) => message(packed(1, range(line, start, end)), string(2, symbol), number(3, role));
const idTree = symbol => packed(3, string(1, symbol));
const textA = 'object A { val value = "hé😀" }\r\n';
const textB = 'object B { val result = A.value }\n';
const f = await createSourceLinkedEvidenceFixture([
  { filename: 'A.scala', text: textA, language: 'scala' }, { filename: 'B.scala', text: textB, language: 'scala' }
]);
try {
  assertProviderDeclaration(SEMANTICDB_PROVIDER_DECLARATION);
  const buildTarget = 'bsp://fixture/scala-3-jvm';
  const valueSymbol = 'fixture/A.value.', localSymbol = 'local0';
  const doc = ({ filename, text, occurrences, synthetics = [], target = buildTarget }) => message(
    number(1, 4), string(2, filename), string(3, text), number(10, 1),
    string(11, createHash('md5').update(text).digest('hex').toUpperCase()), string(13, target),
    packed(5, message(string(1, valueSymbol), number(3, 20), string(5, 'value'), packed(17, number(99, 1)))),
    ...occurrences.map(value => packed(6, value)), ...synthetics.map(value => packed(12, value)));
  const artifact = (changes = {}) => packed(1, doc({ filename: 'A.scala', text: textA, occurrences: [
    occurrence(0, 15, 20, valueSymbol, 2), occurrence(0, 7, 8, localSymbol, 2),
    occurrence(0, 27, 28, 'external/Surrogate#', 1)
  ], ...changes }));
  const consumer = () => packed(1, doc({ filename: 'B.scala', text: textB, occurrences: [
    occurrence(0, 26, 31, valueSymbol, 1), occurrence(0, 7, 8, localSymbol, 1),
    occurrence(0, 11, 14, 'external/Missing#', 1)
  ], synthetics: [message(packed(1, range(0, 26, 31)), packed(2, packed(1, packed(1, idTree(valueSymbol)))))] }));
  const prepare = (bytes = message(artifact(), consumer()), changes = {}) => {
    const producingReceipt = { schemaVersion: 1, artifactHash: createHash('sha256').update(bytes).digest('hex'),
      generation: f.generation, profileHash: 'f'.repeat(64), configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64),
      classpathHash: 'c'.repeat(64), buildTarget, targetPlatform: 'jvm', positionEncoding: 'utf-16',
      tool: { family: 'scala3-semanticdb', version: 'fixture-unrun', compilerVersion: '3.fixture-unrun' },
      sources: [...f.sources].map(([filename, item]) => ({ documentPath: filename, sourcePath: filename,
        sourceUnitId: item.source.sourceUnitId, byteHash: item.source.byteHash, syntaxPartitionId: item.syntax.partitionId,
        syntaxHash: item.syntax.canonicalHash, mappingIdentity: item.source.mapping?.identity ?? null })) };
    return { bytes, producingReceipt, expectedReceiptHash: semanticHash('tooling.semanticdb-producing-receipt.v1', producingReceipt),
      generation: f.generation, documents: f.sources, ...changes };
  };
  const options = prepare(), prepared = prepareSemanticdbReferenceEvidence(options), report = prepared.report;
  const result = report.results.find(value => value.path === 'B.scala');
  assert.equal(prepared.status, 'partial');
  assert.equal(result.references.find(value => value.name === localSymbol).target, null, 'local symbols are document scoped');
  assert.equal(result.references.find(value => value.name === valueSymbol).target.path, 'A.scala');
  assert.ok(result.references.some(value => value.family === 'semanticdbSyntheticApplication' && value.target?.path === 'A.scala'));
  assert.deepEqual(Buffer.from(report.artifact.base64, 'base64'), options.bytes);
  assert.ok(report.results[0].symbols[0].signatureBase64);
  assert.equal(report.coverage.structuredSignatures, false);
  assert.equal(report.results[0].occurrences.find(value => value.symbol === 'external/Surrogate#').span, null,
    'a UTF-16 coordinate inside a surrogate pair is not an original source witness');
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const partition = written.output.partitions.find(value => value.sourceUnitId === result.sourceUnitId);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: partition.partitionId, localId: 0 }, targetStoreForSource: () => store });
  assert.ok(detail.navigationCandidates.some(value => value.family === 'semanticdbSyntheticApplication' && value.path === 'A.scala'));
  assert.equal(detail.partial, true);
  assert.equal(prepareSemanticdbReferenceEvidence({ ...options, producingReceipt: null }).report, null);
  assert.throws(() => prepareSemanticdbReferenceEvidence({ ...options, generation: { baseBuildId: 'wrong', semanticRevision: 0 } }), /receipt mismatch/);
  assert.throws(() => prepareSemanticdbReferenceEvidence(prepare(message(artifact({ text: textA + ' ' }), consumer()))), /text is stale/);
  assert.throws(() => prepareSemanticdbReferenceEvidence(prepare(message(artifact({ target: 'bsp://other' }), consumer()))), /another build target/);
  assert.throws(() => prepareSemanticdbReferenceEvidence(prepare(message(artifact({ filename: '..%2FA.scala' }), consumer()))), /outside.*closure/);
  const ambiguous = prepareSemanticdbReferenceEvidence(prepare(message(artifact({ occurrences: [
    occurrence(0, 15, 20, valueSymbol, 2), occurrence(0, 7, 8, valueSymbol, 2)
  ] }), consumer()))).report.results.find(value => value.path === 'B.scala').references.find(value => value.name === valueSymbol);
  assert.equal(ambiguous.target, null); assert.equal(ambiguous.candidates.length, 2);
  assert.throws(() => prepareSemanticdbReferenceEvidence({ ...options, maxReferences: 1 }), /reference budget/);
  assert.throws(() => prepareSemanticdbReferenceEvidence({ ...options, maxNodes: 1 }), /message\/depth budget/);
  const mutable = prepare();
  mutable.generation = { ...f.generation };
  mutable.producingReceipt = JSON.parse(JSON.stringify(mutable.producingReceipt));
  const originalBytes = Buffer.from(mutable.bytes), originalGeneration = { ...mutable.generation };
  const originalTool = mutable.producingReceipt.tool.version;
  let callbacks = 0;
  const pinned = prepareSemanticdbReferenceEvidence({ ...mutable, signal: { get aborted() {
    if (++callbacks === 1) {
      mutable.generation.semanticRevision++;
      mutable.producingReceipt.tool.version = 'changed-during-cancellation-inspection';
      mutable.bytes.fill(0);
    }
    return false;
  } } }).report;
  assert.ok(callbacks > 0);
  assert.deepEqual(pinned.generation, originalGeneration);
  assert.equal(pinned.runtime.version, originalTool);
  assert.deepEqual(Buffer.from(pinned.artifact.base64, 'base64'), originalBytes,
    'receipt, generation and artifact ownership precede external cancellation callbacks');
  const abort = new AbortController(); abort.abort();
  assert.throws(() => prepareSemanticdbReferenceEvidence({ ...options, signal: abort.signal }), { name: 'AbortError' });
  console.log('Source/build-target pinned SemanticDB occurrences and synthetic applications reach canonical detail');
} finally { await f.cleanup(); }
