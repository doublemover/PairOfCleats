import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../../../src/index/semantic/identity.js';
import { finalizeSourceLinkedReport } from '../../../src/index/tooling/source-linked-report.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticDetailService, getSemanticDetailBudgetUsage } from '../../../src/semantic/detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

// UNVALIDATED. Synthetic source inventory and supplied report metadata exercise
// the actual writer/sink/detail owners; no schema service or source executes.
const domain = 'semantic.fixture-bounded-hash.v1', simple = { text: '名😀\u0000', values: [1, false, null] };
const encoded = canonicalSemanticJson(simple), exact = Buffer.byteLength(encoded);
assert.equal(semanticHash(domain, simple, { maxBytes: exact }), semanticHash(domain, simple));
assert.throws(() => semanticHash(domain, simple, { maxBytes: exact - 1 }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
assert.throws(() => semanticHash(domain, simple, { maxBytes: encoded.length }), { code: 'ERR_SEMANTIC_JSON_BUDGET' });
const interrupted = new Error('bounded identity interrupted');
assert.throws(() => semanticHash(domain, simple, { maxBytes: exact, check() { throw interrupted; } }), error => error === interrupted);
let getters = 0;
assert.throws(() => semanticHash(domain, { get text() { getters++; return 'active'; } }, { maxBytes: 1024 }), /getters/);
assert.equal(getters, 0);
let nested = null;
for (let depth = 0; depth < 20000; depth++) nested = { nested };
const deepEncoding = canonicalSemanticJson(nested, { maxBytes: 1024 * 1024 });
assert.equal(semanticHash(domain, nested, { maxBytes: 1024 * 1024 }), createHash('sha256')
  .update(domain + '\0').update(deepEncoding).digest('hex'), 'bounded hash retains its exact domain/canonical bytes without recursive descent');

const f = await createSourceLinkedEvidenceFixture([{ filename: 'data.json', language: 'json', text: '{"value":"名😀"}' }]);
try {
  const item = f.sources.get('data.json');
  const target = { path: item.source.path, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash, span: [2, 7] };
  const report = finalizeSourceLinkedReport({ schemaVersion: 1, kind: 'source-linked-evidence',
    producerId: 'configuration-local-references', adapterVersion: '2', method: 'fixture/deep-metadata',
    evidenceKind: 'configuration-local-references', generation: f.generation,
    runtime: { family: 'fixture', version: 'unrun', qualification: 'synthetic-source-inventory', profileHash: null },
    project: { configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) },
    results: [{ path: item.source.path, sourceUnitId: item.source.sourceUnitId, sourceHash: item.source.byteHash,
      state: 'partial', reason: 'fixture_observation', references: [{ name: 'value', family: 'configurationReference',
        span: [2, 7], target, candidates: [target], state: 'resolved', reason: null }], diagnostics: [] }],
    retainedMetadata: nested }, { maxBytes: 1024 * 1024,
    fail: message => new Error(message), message: 'fixture final report budget' });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  assert.equal(written.persisted, 1);
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const ref = { partitionId: written.output.partitions[0].partitionId, localId: 0 };
  const detail = await readSourceLinkedEvidenceDetail({ store, ref });
  assert.equal(detail.report.identity, report.identity);
  assert.equal(detail.navigationCandidates[0].path, 'data.json');
  let value = detail.report.retainedMetadata, depth = 0;
  while (value) { depth++; value = value.nested; }
  assert.equal(depth, 20000, 'the admitted complete metadata survives the actual durable sidecar and bounded detail owner');
  const service = createSemanticDetailService(), entries = [];
  let cursor = null, pages = 0;
  do {
    const page = await service({ store, request: { repoRoot: f.root, generation: f.generation,
      refs: [ref], fields: ['span'], include: ['providerEvidence'], cursor } });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) + getSemanticDetailBudgetUsage(page).retainedEvidenceBytes <= 65536);
    entries.push(...page.providerEvidence); cursor = page.cursor;
    assert.ok(++pages < 8);
  } while (cursor);
  assert.equal(entries.length, 1); assert.equal(entries[0].kind, 'state');
  assert.equal(entries[0].state, 'budget'); assert.equal(entries[0].qualification, 'unavailable');
  assert.equal(JSON.stringify(entries).includes('retainedMetadata'), false,
    'the existing public page bound rejects the large sidecar explicitly instead of returning raw report metadata');
  console.log('bounded canonical identity preserves deep source-linked evidence through writer, sink and internal/public detail');
} finally { await f.cleanup(); }
