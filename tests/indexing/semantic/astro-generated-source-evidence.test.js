import assert from 'node:assert/strict';
import { createAstroGeneratedDocument, mapAstroGeneratedRange, qualifyAstroGeneratedMap } from '../../../src/index/tooling/vfs/astro-generated-document.js';
import { prepareAstroMappedEvidence, ASTRO_MAPPED_PROVIDER_DECLARATION } from '../../../src/index/tooling/astro-mapped-evidence.js';
import { writeSourceLinkedEvidence } from '../../../src/index/tooling/source-linked-evidence.js';
import { readSourceLinkedEvidenceDetail } from '../../../src/semantic/source-linked-evidence-detail.js';
import { createSemanticProviderResultSink } from '../../../src/index/semantic/merge-provider.js';
import { assertProviderDeclaration } from '../../../src/index/tooling/provider-declaration.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createSourceLinkedEvidenceFixture } from '../../helpers/source-linked-evidence-fixture.js';

// UNVALIDATED: real pinned compiler transform, synthetic original parser row and
// captured service observations. No live service or binding acquisition proof.
const map = (mappings, originalText = 'title') => ({ version: 3, file: 'Page.tsx', sources: ['Page.astro'],
  sourcesContent: [originalText], names: [], mappings });
const simple = qualifyAstroGeneratedMap({ map: map('EAAA,KAAK'), code: '__title', originalText: 'title', filename: 'Page.astro' });
assert.deepEqual(simple.intervals, [
  { generated: [0, 2], original: null, quality: 'synthetic' },
  { generated: [2, 7], original: [0, 5], quality: 'exact' }
]);
const unicode = qualifyAstroGeneratedMap({ map: map('AAAA,EAAE,KAAK', '😀title'), code: '😀title', originalText: '😀title', filename: 'Page.astro' });
assert.deepEqual(unicode.intervals[1].original, [2, 7]);
assert.equal(qualifyAstroGeneratedMap({ map: map('AAAA'), code: 'title', originalText: 'title', filename: 'Page.astro' }).intervals[0].quality, 'coarse');
assert.throws(() => qualifyAstroGeneratedMap({ map: map('AAAA,AAAC'), code: 'title', originalText: 'title', filename: 'Page.astro' }), /Conflicting/);
assert.throws(() => qualifyAstroGeneratedMap({ map: map('CAAA', '😀title'), code: '😀title', originalText: '😀title', filename: 'Page.astro' }), /exact source coordinate/);
assert.throws(() => qualifyAstroGeneratedMap({ map: map('EAAA,KAAK'), code: '__title', originalText: 'title', filename: 'Page.astro', maxPoints: 1 }), /point budget/);
const text = '---\r\nconst title: string = "hé😀";\r\n---\r\n<main>{title}</main>';
const f = await createSourceLinkedEvidenceFixture([{ filename: 'Page.astro', text, language: 'astro' }]);
try {
  assertProviderDeclaration(ASTRO_MAPPED_PROVIDER_DECLARATION);
  const item = f.sources.get('Page.astro');
  const document = createAstroGeneratedDocument({ item, generation: f.generation, configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) });
  assert.equal(document.languageId, 'typescriptreact');
  assert.equal(document.runtime.version, '4.0.0');
  assert.equal(document.adapterVersion, '3');
  const strippedBoundary = document.code.indexOf('\r\n');
  assert.ok(strippedBoundary >= 0);
  assert.deepEqual(mapAstroGeneratedRange(document, [strippedBoundary, strippedBoundary + 2]),
    { quality: 'coarse', spans: [] }, 'conflicting compiler boundary anchors never choose an original source');
  assert.throws(() => qualifyAstroGeneratedMap({ map: document.map, code: document.code,
    originalText: text, filename: 'Page.astro' }), /Conflicting/,
  'a serialized compiler-looking map cannot grant itself the live adapter qualification');
  const mapped = [];
  for (const match of document.code.matchAll(/\btitle\b/gu)) {
    const generated = [match.index, match.index + match[0].length];
    const result = mapAstroGeneratedRange(document, generated);
    if (result.quality === 'exact' && result.spans.length === 1) mapped.push({ generated, original: result.spans[0] });
  }
  const definition = mapped.find(value => value.original[0] === text.indexOf('title'));
  const use = mapped.find(value => value.original[0] === text.lastIndexOf('title'));
  assert.ok(definition, 'compiler map retains the frontmatter declaration');
  assert.ok(use, 'compiler map retains the template expression');
  assert.equal(text.slice(...use.original), 'title');
  assert.throws(() => mapAstroGeneratedRange({ ...document }, use.generated), /admitted document/);
  const observed = { method: 'definition', name: 'title', from: use.generated,
    targetDocumentIdentity: document.identity, target: definition.generated };
  const prepare = (observations = [observed, observed], changes = {}) => {
    const producingReceipt = { schemaVersion: 1, generatedDocumentIdentity: document.identity,
      observationsHash: semanticHash('tooling.astro-observations.v1', observations), generation: f.generation,
      configHash: document.configHash, dependencyHash: document.dependencyHash, serviceProfileHash: 'f'.repeat(64),
      tool: { family: 'typescript-language-service', version: 'fixture-captured-unrun' } };
    return { document, observations, producingReceipt,
      expectedReceiptHash: semanticHash('tooling.astro-observation-receipt.v1', producingReceipt), ...changes };
  };
  const options = prepare(), prepared = prepareAstroMappedEvidence(options), report = prepared.report;
  assert.equal(report.results[0].references.length, 1);
  assert.equal(report.results[0].references[0].producerObservations, 2);
  assert.deepEqual(report.results[0].references[0].target.span, definition.original);
  const written = await writeSourceLinkedEvidence({ report, sources: f.sources, state: f.state, policy: f.policy,
    semanticSink: createSemanticProviderResultSink({ state: f.state, runtime: f.runtime }) });
  const store = f.store([...f.syntaxPartitions, ...written.output.partitions]);
  const detail = await readSourceLinkedEvidenceDetail({ store, ref: { partitionId: written.output.partitions[0].partitionId, localId: 0 } });
  assert.equal(detail.navigationCandidates[0].path, 'Page.astro');
  assert.equal(text.slice(...detail.navigationCandidates[0].span), 'title');
  assert.equal(detail.partial, true);
  assert.equal(report.coverage.frameworkServiceAcquisition, false);
  const external = prepareAstroMappedEvidence(prepare([{ ...observed, targetDocumentIdentity: 'external' }])).report;
  assert.equal(external.results[0].references[0].target, null);
  assert.equal(external.results[0].references[0].reason, 'generated_target_external');
  assert.equal(prepareAstroMappedEvidence({ ...options, producingReceipt: null }).report, null);
  assert.throws(() => prepareAstroMappedEvidence({ ...options, document: { ...document,
    generation: { baseBuildId: 'wrong', semanticRevision: 0 } } }), /receipt mismatch/);
  assert.throws(() => createAstroGeneratedDocument({ item, generation: { baseBuildId: 'wrong', semanticRevision: 0 },
    configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64) }), /original source\/context/);
  const abort = new AbortController(); abort.abort();
  assert.throws(() => createAstroGeneratedDocument({ item, generation: f.generation,
    configHash: 'a'.repeat(64), dependencyHash: 'b'.repeat(64), signal: abort.signal }), { name: 'AbortError' });
  console.log('Astro compiler-generated map witnesses reach canonical original-source detail without admitting TSX as a user file');
} finally { await f.cleanup(); }
