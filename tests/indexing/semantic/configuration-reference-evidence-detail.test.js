import assert from 'node:assert/strict';
import { collectJsonReferenceEvidence, createJsonReferenceEvidenceReport } from '../../../src/index/tooling/config-reference-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

const f = await createSourceLinkedEvidenceFixture([
  { filename: 'config.json', text: '{"value":{"$ref":"schema.json#/$defs/value"}}', language: 'json' },
  { filename: 'schema.json', text: '{"$defs":{"value":{"type":"string"}}}', language: 'json' }
]);
try {
  const evidence = collectJsonReferenceEvidence({ documents: f.sources, maxMs: 1000 });
  const report = createJsonReferenceEvidenceReport({ evidence, generation: f.generation, configHash: 'd'.repeat(64), dependencyHash: 'e'.repeat(64) });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  assert.equal(written.persisted, 2);
  const partition = written.output.partitions.find(value => value.sourceUnitId === f.sources.get('config.json').source.sourceUnitId);
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: partition.partitionId, localId: 0 }, targetStoreForSource: () => store });
  assert.equal(detail.navigationCandidates[0].path, 'schema.json');
  assert.equal(detail.report.coverage.schemaValidation, false);
  assert.equal(detail.partial, true);
  assert.equal(detail.result.references[0].target.pointer, '/$defs/value');
  console.log('offline JSON reference subset through canonical evidence persistence and source-qualified detail');
} finally { await f.cleanup(); }
