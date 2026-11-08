import assert from 'node:assert/strict';
import { collectJsonReferenceEvidence, createJsonReferenceEvidenceReport } from '../../../src/index/tooling/config-reference-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { canonicalSemanticJson } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

// Authored only. Common external-report admission and real writer/sink/detail.
// The parser inventory is synthetic; no source, library or provider runs here.
const fixture = await createSourceLinkedEvidenceFixture([
  { filename: 'config.json', text: '{"value":{"$ref":"schema.json#/$defs/value"}}', language: 'json' },
  { filename: 'schema.json', text: '{"$defs":{"value":{"type":"string"}}}', language: 'json' }
]);
try {
  const evidence = collectJsonReferenceEvidence({ documents: fixture.sources });
  const report = createJsonReferenceEvidenceReport({ evidence, generation: fixture.generation,
    configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) });
  const base = { sources: fixture.sources, state: fixture.state, policy: fixture.policy };
  const exactBytes = Buffer.byteLength(canonicalSemanticJson(report));
  await assert.rejects(writeSourceLinkedEvidence({ ...base, report, maxBytes: exactBytes - 1 }),
    { code: 'ERR_SOURCE_LINKED_EVIDENCE', message: 'Source-linked report byte budget exhausted.' });
  let enumerations = 0, getters = 0;
  const gigantic = new Proxy(new Array(1000000), { ownKeys() { enumerations++; throw new Error('encoded size must reject this array before enumeration'); } });
  await assert.rejects(writeSourceLinkedEvidence({ ...base, report: { ...report, extra: gigantic } }),
    { code: 'ERR_SOURCE_LINKED_EVIDENCE', message: 'Source-linked report byte budget exhausted.' });
  assert.equal(enumerations, 0, 'external reports cannot bypass bounded canonical admission through the writer');
  const accessor = { ...report };
  Object.defineProperty(accessor, 'extra', { enumerable: true, get() { getters++; return null; } });
  await assert.rejects(writeSourceLinkedEvidence({ ...base, report: accessor }), /getters/);
  assert.equal(getters, 0);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(writeSourceLinkedEvidence({ ...base, report, signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(fixture.state.semanticEvidenceArtifacts.length, 0, 'rejected reports cannot register partial evidence');
  const written = await writeSourceLinkedEvidence({ ...base, report,
    semanticSink: createSemanticProviderResultSink({ state: fixture.state, runtime: fixture.runtime }) });
  assert.equal(written.persisted, 2);
  assert.equal(written.identity, report.identity);
  const partition = written.output.partitions.find(value => value.sourceUnitId === fixture.sources.get('config.json').source.sourceUnitId);
  const store = fixture.store([...fixture.syntaxPartitions, ...written.output.partitions]);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: partition.partitionId, localId: 0 }, targetStoreForSource: () => store });
  assert.equal(detail.navigationCandidates[0].path, 'schema.json');
  assert.equal(detail.partial, true, 'bounded encoding cannot upgrade source-linked semantic coverage');
  console.log('source-linked common writer bounds caller reports before snapshot expansion and retains sink/detail ownership');
} finally { await fixture.cleanup(); }
