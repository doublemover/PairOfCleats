import assert from 'node:assert/strict';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createSemanticPartitionSink } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { writeSemanticQueryIndex } from '../../../src/index/build/artifacts/writers/semantic/query-index.js';
import { fingerprintSemanticOperation } from '../../../src/semantic/operation-fingerprint.js';
const text = 'const a = 1 + 2; const b = 1 + 3; const c = 0x1 + 2; const d = 1 + 2; const s = "é"; const t = "e";';
const fixture = await createRecoveryFixture(text);
try {
  const collector = createSemanticCollector({ ast: parseJavaScriptAst(text), source: fixture.source, partitionId: fixture.partitionId });
  const sink = await createSemanticPartitionSink({ ...fixture.options, structuralSlots: collector.structuralSlots });
  for (const batch of collector.batches) await sink.appendBatch(batch);
  const partition = await sink.finalizeSource(), base = fixture.store([partition]);
  const queryIndex = await writeSemanticQueryIndex({ root: fixture.stagingRoot, generation: fixture.generation,
    partitions: [partition], store: base, diskAccount: fixture.account });
  const store = fixture.store([partition], { queryIndex }), expressions = [];
  for await (const row of store.iterateRows(partition.partitionId, 'semantic_records')) if (row.kind === 'expression') expressions.push(row);
  const binaries = expressions.filter(row => row.data.astKind === 'BinaryExpression');
  const fingerprints = [];
  for (const row of binaries) fingerprints.push(await fingerprintSemanticOperation({ store, ref: { partitionId: partition.partitionId, localId: row.id } }));
  assert.ok(fingerprints.every(value => value.projectionVersion === 2 && value.complete));
  assert.notEqual(fingerprints[0].hash, fingerprints[1].hash, 'literal values distinguish equal-shaped expressions');
  assert.notEqual(fingerprints[0].hash, fingerprints[2].hash, 'exact numeric spelling is retained, not normalized into an equivalence claim');
  assert.equal(fingerprints[0].hash, fingerprints[3].hash, 'same ordered syntax and literal text remain equal across offsets');
  const ref = { partitionId: partition.partitionId, localId: binaries[0].id };
  const missing = await fingerprintSemanticOperation({ store: { ...store, getSourceSpans: null }, ref });
  assert.equal(missing.complete, false); assert.ok(missing.reasons.includes('literal_source_projection_unavailable'));
  const bounded = await fingerprintSemanticOperation({ store: { ...store, getSourceSpans: async () => { throw Object.assign(new Error('large'), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' }); } }, ref });
  assert.equal(bounded.complete, false); assert.ok(bounded.reasons.includes('literal_source_projection_budget'));
  await assert.rejects(fingerprintSemanticOperation({ store: { ...store, getSourceSpans: async () => { throw Object.assign(new Error('corrupt'), { code: 'ERR_SEMANTIC_INTEGRITY' }); } }, ref }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  console.log('Literal-aware bounded structural fingerprints preserve exact retained text and unknowns');
} finally { await fixture.cleanup(); }
