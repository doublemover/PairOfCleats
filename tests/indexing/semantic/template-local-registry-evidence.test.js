import assert from 'node:assert/strict';
import { collectTemplateReferenceEvidence, TEMPLATE_REFERENCE_PROVIDER_DECLARATION } from '../../../src/index/tooling/template-reference-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

const helper = 'export function format(value) { return value; }';
const inputs = [
  { filename: 'main.hbs', language: 'handlebars', text: '{{! 🧭 original }}\r\n{{format user}}\n{{> card}}\n{{> (lookup . "which")}}\n{{#each users as |format|}}{{format}}{{/each}}\n{{#*inline "local"}}{{format user}}{{/inline}}' },
  { filename: 'card.hbs', language: 'handlebars', text: '{{> main}}\n{{title}}' },
  { filename: 'main.mustache', language: 'mustache', text: '{{=<% %>=}}\n<%> line %>\n<%#items%><%value%><%/items%>' },
  { filename: 'line.mustache', language: 'mustache', text: '{{> missing}} {{value}}' },
  { filename: 'format.js', language: 'javascript', text: helper }
];
const f = await createSourceLinkedEvidenceFixture(inputs);
try {
  assertProviderDeclaration(TEMPLATE_REFERENCE_PROVIDER_DECLARATION);
  const descriptor = filename => ({ path: filename, span: [0, f.sources.get(filename).text.length] });
  const options = { documents: f.sources, templates: inputs.filter(value => value.language !== 'javascript')
    .map(value => ({ path: value.filename, dialect: value.language })), generation: f.generation,
  configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64), helpers: new Map([['format', {
    path: 'format.js', span: [helper.indexOf('format'), helper.indexOf('format') + 'format'.length]
  }], ['inline', { path: 'format.js', span: [helper.indexOf('format'), helper.indexOf('format') + 'format'.length] }]]),
  partials: new Map([['main', descriptor('main.hbs')], ['card', descriptor('card.hbs')], ['line', descriptor('line.mustache')]]) };
  const report = collectTemplateReferenceEvidence(options);
  assert.equal(report.coverage.rendered, false);
  assert.equal(report.coverage.loaderExecuted, false);
  const main = report.results.find(value => value.path === 'main.hbs');
  assert.equal(report.adapterVersion, '3');
  assert.equal(report.adapterVersion, TEMPLATE_REFERENCE_PROVIDER_DECLARATION.adapterVersion);
  assert.ok(!main.references.some(value => value.family === 'helper' && value.name === 'inline'),
    'the real source-linked consumer cannot resolve a declaration directive through a same-named helper registry entry');
  assert.ok(main.references.some(value => value.family === 'helper' && value.name === 'format' && value.target?.path === 'format.js'));
  assert.ok(main.references.some(value => value.name === 'format' && value.reason === 'local_block_parameter' && value.target === null),
    'a local block parameter cannot silently bind to the global helper registry');
  assert.ok(main.references.some(value => value.family === 'partial' && value.reason === 'dynamic_partial_unresolved'));
  assert.ok(main.diagnostics.some(value => value.code === 'partial_cycle'));
  const mustache = report.results.find(value => value.path === 'main.mustache');
  assert.equal(mustache.references.find(value => value.family === 'partial').target.path, 'line.mustache');
  assert.ok(mustache.references.some(value => value.reason === 'section_runtime_context_unknown'));
  const changed = collectTemplateReferenceEvidence({ ...options, helpers: new Map() });
  assert.notEqual(changed.project.registryHash, report.project.registryHash);
  assert.notEqual(changed.identity, report.identity);
  assert.throws(() => collectTemplateReferenceEvidence({ ...options, partials: new Map([['outside', { path: '../outside.hbs', span: [0, 1] }]]) }), { code: 'ERR_TEMPLATE_REFERENCE_EVIDENCE' });
  assert.throws(() => collectTemplateReferenceEvidence({ ...options, maxReferences: 1 }), { code: 'ERR_TEMPLATE_REFERENCE_EVIDENCE' });
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const partition = written.output.partitions.find(value => value.sourceUnitId === main.sourceUnitId);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: partition.partitionId, localId: 0 }, targetStoreForSource: () => store });
  assert.ok(detail.navigationCandidates.some(value => value.family === 'helper' && value.path === 'format.js'));
  assert.ok(detail.navigationCandidates.some(value => value.family === 'partial' && value.path === 'card.hbs'));
  assert.equal(detail.partial, true);
  console.log('parse-only Handlebars/Mustache explicit registry links through canonical sink and bounded source detail');
} finally { await f.cleanup(); }
