import assert from 'node:assert/strict';
import { collectGraphqlLinkedEvidence, GRAPHQL_LINKED_PROVIDER_DECLARATION } from '../../../src/index/tooling/graphql-linked-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { createSemanticDetailService } from '../../../src/semantic/detail.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';

// Authored, UNVALIDATED: a real GraphQL.js API path and actual canonical writer,
// sink and detail contract, with a synthetic immutable parser inventory.
const schema = 'type Query { user(id: ID!): User }\ntype User { name: String }';
const query = '# 🧭 original preamble\nquery Find { user(id: "1") { ...Name } }\nfragment Name on User { name }';
const f = await createSourceLinkedEvidenceFixture([
  { filename: 'schema.graphql', text: schema, language: 'graphql' },
  { filename: 'query.graphql', text: query, language: 'graphql' }
]);
try {
  assertProviderDeclaration(GRAPHQL_LINKED_PROVIDER_DECLARATION);
  const options = { documents: f.sources, schemaPaths: ['schema.graphql'], documentPaths: ['query.graphql'],
    generation: f.generation, configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64), maxMs: 1000 };
  const report = collectGraphqlLinkedEvidence(options);
  assert.equal(report.runtime.version, '16.12.0');
  assert.equal(report.coverage.schemaConstructed, true);
  assert.equal(report.coverage.remoteIntrospection, false);
  assert.equal(report.coverage.runtimeCallFlow, false);
  const result = report.results.find(value => value.path === 'query.graphql');
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.state, 'partial', 'an unobserved app module closure never claims complete compiler coverage');
  for (const [family, name] of [['field', 'user'], ['argument', 'id'], ['fragment', 'Name'], ['type', 'User'], ['field', 'name']]) {
    const reference = result.references.find(value => value.family === family && value.name === name);
    assert.equal(reference.state, 'resolved');
    assert.equal(query.slice(...reference.span), name);
    assert.equal(f.sources.get(reference.target.path).text.slice(...reference.target.span), name);
  }
  assert.notEqual(collectGraphqlLinkedEvidence({ ...options, dependencyHash: 'c'.repeat(64) }).identity, report.identity);
  const semanticSink = createSemanticProviderResultSink({ state: f.state, runtime: f.runtime });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy, semanticSink });
  assert.equal(written.persisted, 2);
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const partition = written.output.partitions.find(value => value.sourceUnitId === result.sourceUnitId);
  const ref = { partitionId: partition.partitionId, localId: 0 };
  const detail = await createSemanticDetailService()({ store, request: { repoRoot: f.root, generation: f.generation, refs: [ref] } });
  assert.equal(detail.records[0].data.evidenceKind, 'graphql-schema-references');
  const linked = await readSourceLinkedEvidenceDetail({ store, ref, targetStoreForSource: () => store });
  assert.ok(linked.navigationCandidates.some(value => value.family === 'fragment' && value.path === 'query.graphql'));
  assert.ok(linked.navigationCandidates.some(value => value.family === 'field' && value.path === 'schema.graphql'));
  const bounded = await readSourceLinkedEvidenceDetail({ store, ref, maxReferences: 1 });
  assert.equal(bounded.omittedReferences, result.references.length - 1);
  assert.ok(bounded.unresolvedTargets.length, 'cross-source targets require an admitted generation store');
  await assert.rejects(readSourceLinkedEvidenceDetail({ store: { ...store, generation: { baseBuildId: 'wrong', semanticRevision: 0 } }, ref }), { code: 'ERR_SOURCE_LINKED_EVIDENCE' });
  const tampered = structuredClone(report);
  tampered.results.find(value => value.path === 'query.graphql').references[0].target.sourceHash = 'f'.repeat(64);
  const { identity: _identity, ...changed } = tampered;
  tampered.identity = semanticHash('tooling.source-linked-evidence.v1', changed);
  await assert.rejects(writeSourceLinkedEvidence({ report: tampered, sources: f.sources, state: f.state, policy: f.policy }), { code: 'ERR_SOURCE_LINKED_EVIDENCE' });
  const invalid = new Map(f.sources), text = schema + '\ntype User { other: String }';
  invalid.set('schema.graphql', { text, source: createSemanticSourceSnapshot({ bytes: Buffer.from(text), path: 'schema.graphql',
    repositoryNamespace: f.root, language: 'graphql' }).manifest });
  const duplicate = collectGraphqlLinkedEvidence({ ...options, documents: invalid });
  assert.equal(duplicate.coverage.schemaConstructed, false);
  assert.ok(duplicate.results.find(value => value.path === 'schema.graphql').diagnostics.length);
  assert.throws(() => collectGraphqlLinkedEvidence({ ...options, maxNodes: 4 }), { code: 'ERR_GRAPHQL_LINKED_EVIDENCE' });
  const abort = new AbortController(); abort.abort();
  assert.throws(() => collectGraphqlLinkedEvidence({ ...options, signal: abort.signal }), { name: 'AbortError' });
  console.log('local GraphQL schema/operation references through canonical evidence sink and bounded detail');
} finally { await f.cleanup(); }
