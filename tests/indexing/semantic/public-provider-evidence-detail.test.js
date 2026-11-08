import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectJsonReferenceEvidence, createJsonReferenceEvidenceReport } from '../../../src/index/tooling/config-reference-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';
import { createSemanticDetailService, getSemanticDetailBudgetUsage } from '../../../src/semantic/detail.js';
import { createSemanticDetailRunner } from '../../../src/integrations/tooling/semantic-detail.js';
import { assertSemanticQuery } from '../../../src/contracts/validators/semantic-query.js';

// UNVALIDATED. This exercises actual writer/sink/store/public runner contracts
// under a synthetic parser inventory, not a published full-index qualification.
const f = await createSourceLinkedEvidenceFixture([
  { filename: 'config.json', text: '{"first":{"$ref":"schema.json#/$defs/a"},"second":{"$ref":"schema.json#/$defs/b"}}', language: 'json' },
  { filename: 'schema.json', text: '{"$defs":{"a":{"type":"string"},"b":{"type":"number"}}}', language: 'json' }
]);
try {
  const report = createJsonReferenceEvidenceReport({ evidence: collectJsonReferenceEvidence({ documents: f.sources }),
    generation: f.generation, configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const partition = written.output.partitions.find(value => value.sourceUnitId === f.sources.get('config.json').source.sourceUnitId);
  const ref = { partitionId: partition.partitionId, localId: 0 };
  const rawStore = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  let verified = 0, openOptions;
  const store = { ...rawStore, async verifySource(...args) { verified++; return rawStore.verifySource(...args); } };
  const request = { repoRoot: f.root, generation: f.generation, refs: [ref], fields: ['span'], include: ['providerEvidence'] };
  const plain = await createSemanticDetailService()({ store, request: { ...request, include: [] } });
  assert.equal(verified, 0, 'default detail does not hydrate or verify provider sidecars');
  assert.equal(plain.providerEvidence, undefined);
  const runner = createSemanticDetailRunner({ openStore: async options => { openOptions = options; return { store }; } });
  const userConfig = { indexing: { semantic: { enabled: true } } };
  let cursor = null, pages = 0;
  const entries = [];
  do {
    const page = await runner({ ...request, cursor }, { userConfig });
    assertSemanticQuery('detailResult', page);
    assert.equal(openOptions.requireQueryIndex, false, 'direct evidence refs do not scan or require relation indexes');
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 65536);
    assert.ok(page.coverage.response.hydratedCount <= 512);
    assert.ok(page.records.every(record => !Object.hasOwn(record, 'data')), 'requested field omission stays strict');
    assert.ok(!JSON.stringify(page.providerEvidence).includes('descriptorArtifact'));
    entries.push(...page.providerEvidence);
    cursor = page.cursor;
    assert.ok(++pages < 8, 'evidence cursor makes bounded progress');
  } while (cursor);
  assert.equal(entries.length, 2);
  assert.ok(entries.every(entry => entry.kind === 'reference' && entry.target.path === 'schema.json'));
  assert.ok(entries.every(entry => entry.qualification === 'source-qualified-observation' && entry.state === 'partial'));
  const contractPage = await createSemanticDetailService()({ store, request });
  const invalidEvidence = entry => ({ ...contractPage, providerEvidence: [entry] });
  assert.throws(() => assertSemanticQuery('detailResult', invalidEvidence({ ...entries[0], diagnostic: {
    code: 'forged', message: 'cross-kind output', severity: 'warning', truncated: false
  } })), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' }, 'evidence variants cannot disclose arbitrary cross-kind fields');
  assert.throws(() => assertSemanticQuery('detailResult', invalidEvidence({ ...entries[0], qualification: 'provider-observation' })),
    { code: 'ERR_SEMANTIC_QUERY_CONTRACT' }, 'captured observations cannot carry qualified navigation');
  assert.throws(() => assertSemanticQuery('detailResult', invalidEvidence({ ...entries[0], target: null })),
    /reference state/, 'resolved projection requires its exact qualified target');
  assert.throws(() => assertSemanticQuery('detailResult', invalidEvidence({ ...entries[0], candidateCount: 0 })),
    /reference state/, 'navigable evidence has at least one retained witness');
  assert.ok(verified > 0);
  const service = createSemanticDetailService();
  const first = await service({ store, request });
  assert.ok(first.cursor);
  assert.ok(getSemanticDetailBudgetUsage(first).retainedEvidenceBytes > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(first)) + getSemanticDetailBudgetUsage(first).retainedEvidenceBytes <= 65536);
  await assert.rejects(service({ store, request: { ...request, include: [], cursor: first.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  await assert.rejects(service({ store: { ...store, cursorScope: 'another-inventory' }, request: { ...request, cursor: first.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
  const limited = createSemanticDetailService();
  const limitedRequest = { ...request, limits: { rows: 1 } };
  const limitedFirst = await limited({ store, request: limitedRequest });
  const limitedNext = await limited({ store, request: { ...limitedRequest, cursor: limitedFirst.cursor } });
  assert.equal(limitedNext.providerEvidence[0].state, 'budget');
  assert.equal(limitedNext.providerEvidence[0].qualification, 'unavailable');
  assert.ok(limitedNext.coverage.response.hydratedCount <= 1);
  assert.equal(limitedNext.cursor, null, 'an intrinsically insufficient page does not loop forever');
  const abort = new AbortController(); abort.abort();
  await assert.rejects(service({ store, request, signal: abort.signal }), { name: 'AbortError' });
  const [record] = await store.getRecords([ref], ['data']);
  const artifact = path.join(f.stagingRoot, record.data.artifactRef), original = await fs.readFile(artifact);
  await fs.appendFile(artifact, ' ');
  await assert.rejects(service({ store, request }), { code: 'ERR_FILE_INTEGRITY' });
  await fs.writeFile(artifact, original);
  await fs.rename(artifact, artifact + '.retained-test');
  await assert.rejects(service({ store, request }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  await fs.rename(artifact + '.retained-test', artifact);
  console.log('Explicit public provider evidence detail preserves source authority, page budgets, cursors and corruption failures');
} finally { await f.cleanup(); }
