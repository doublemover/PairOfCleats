import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildLanguageContext, getLanguageForFile } from '../../../src/index/language-registry.js';
import { chunkMustache } from '../../../src/index/chunking/dispatch/heuristic-chunkers.js';
import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { admitFlowEvidence } from '../../../src/shared/flow-evidence.js';
import { validateMetadataV2Semantics } from '../../../src/contracts/validators/metadata.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const literal = 'hello = world; return answer; if ready; while waiting; throw E; await task; yield value;';
const template = getLanguageForFile('.mustache', 'fixture.mustache');
for (const text of [literal, `{{#ready}}{{name}} ${literal}{{/ready}}`]) {
  const chunks = chunkMustache(text);
  assert.ok(chunks.length);
  const relations = template.buildRelations({ text, options: {} });
  if (text.includes('{{name}}')) {
    assert.ok(relations.usages.includes('name'), 'actual template lookup evidence is retained');
    assert.ok(relations.exports.includes('ready'), 'actual section syntax remains distinct from a branch statement');
  }
  for (const chunk of chunks) {
    const docmeta = enrichFlowFixture({ text, chunk, lang: template });
    for (const field of ['dataflow', 'controlFlow', 'throws', 'awaits', 'yields', 'returnsValue']) {
      assert.equal(docmeta[field], undefined, 'literal output has no generic executable fact authority');
      assert.equal(docmeta.flowEvidence.fields[field].state, 'unavailable');
    }
    const payload = assembleFlowFixture({ text, chunk, docmeta, lang: 'mustache', ext: '.mustache' });
    assert.deepEqual(validateMetadataV2Semantics(payload.metaV2), []);
    assert.ok(text.slice(payload.start, payload.end).includes(literal), 'the original output text remains inside the retained source envelope');
    assert.ok(payload.tokens.includes('hello') && payload.tokens.includes('world'), 'ordinary tokenization still indexes literal output text');
    assert.equal(payload.docmeta.source, chunk.meta.parser === 'mustache-parse-tokens' ? 'managed-mustache-syntax' : 'managed-mustache-unavailable');
  }
}

const options = { treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false },
  astDataflowEnabled: true, controlFlowEnabled: true };
const prepare = async body => {
  const text = `class Demo { int first(int value) { ${body} } int second() { if (true) { return 1; } return 0; } }`;
  const input = { text, ext: '.groovy', relPath: 'fixture.groovy', options, mode: 'code' };
  const { lang, context } = await buildLanguageContext(input);
  const chunk = context.groovyChunks.find(row => row.name.endsWith('first') && /Method|Function/.test(row.kind));
  assert.ok(chunk?.meta.syntaxFlow, 'the actual native preparation traversal supplies an owned compact product');
  const docmeta = enrichFlowFixture({ text, chunk, lang, context, options });
  admitFlowEvidence(docmeta.flowEvidence, docmeta);
  assert.deepEqual(docmeta.flowEvidence.source.range, { start: chunk.start, end: chunk.end });
  assert.equal(docmeta.flowEvidence.fields.controlFlow.kind, 'syntactic-control-counts');
  assert.equal(docmeta.flowEvidence.fields.controlFlow.state, 'partial');
  assert.equal(docmeta.flowEvidence.fields.dataflow.state, 'unavailable');
  assert.equal(docmeta.dataflow, undefined, 'syntax does not manufacture semantic reads/writes/aliases');
  const payload = assembleFlowFixture({ text, chunk, docmeta });
  assert.deepEqual(validateMetadataV2Semantics(payload.metaV2), []);
  return { text, chunk, lang, context, docmeta };
};
const baseline = await prepare('return value;');
assert.equal(baseline.docmeta.controlFlow.returns, 1);
assert.equal(baseline.docmeta.controlFlow.branches, 0, 'the second declaration cannot contribute to the first');
const inserted = await prepare(`String note = "${literal}"; /* ${literal} */ return value;`);
for (const field of ['controlFlow', 'throws', 'awaits', 'yields', 'returnsValue']) assert.deepEqual(inserted.docmeta[field], baseline.docmeta[field],
  'identical comment/string text cannot change the native syntax facts');
assert.ok(inserted.text.includes(literal), 'source used by ordinary text indexing remains intact');
const real = await prepare('if (value > 0) { return value; } return 0;');
assert.equal(real.docmeta.controlFlow.branches, 1, 'a real native statement remains a positive control');
assert.equal(real.docmeta.controlFlow.returns, 2);
const nested = await prepare('def delayed = { if (true) { throw new RuntimeException("nested"); } }; return value;');
assert.deepEqual(nested.docmeta.controlFlow, baseline.docmeta.controlFlow, 'anonymous callable bodies retain their separate execution owner');
const disabled = enrichFlowFixture({ text: baseline.text, chunk: baseline.chunk, lang: baseline.lang, context: baseline.context,
  options: { ...options, astDataflowEnabled: false, controlFlowEnabled: false }, enabled: false });
assert.ok(Object.values(disabled.flowEvidence.fields).every(field => field.state === 'disabled'));
assert.equal(disabled.controlFlow, undefined);
const cold = buildTreeSitterChunks({ text: baseline.text, languageId: 'groovy', options: { treeSitter: { enabled: false } } });
assert.equal(cold, null, 'unavailable native preparation is not a verified empty owner');
const unowned = baseline.lang.flow({ text: baseline.text, chunk: { ...baseline.chunk, meta: {} }, options });
assert.equal(unowned.controlFlow, undefined);
assert.ok(Object.values(unowned.flowEvidence.fields).every(field => field.state === 'unavailable'));
const wrongSource = baseline.text + ' ';
assert.throws(() => baseline.lang.flow({ text: wrongSource, chunk: baseline.chunk, options, context: baseline.context }),
  { code: 'ERR_FLOW_EVIDENCE_CONTRACT' }, 'compact native facts cannot be rebound to another source');
const root = await createImportResolutionTempRoot('managed-flow-native-replay');
try {
  const absPath = path.join(root, 'fixture.groovy'); await fs.writeFile(absPath, real.text);
  const stat = await fs.stat(absPath), bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  const payload = assembleFlowFixture({ text: real.text, chunk: real.chunk, docmeta: real.docmeta });
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  manifest.files['fixture.groovy'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest,
    relKey: 'fixture.groovy', fileStat: stat, fileHash: sha1(real.text), fileChunks: [payload], bundleFormat: 'json', fileRelations: {} });
  const { cachedBundle } = await readCachedBundle({ enabled: true, absPath, relKey: 'fixture.groovy', fileStat: stat,
    manifest, bundleDir, bundleFormat: 'json' });
  assert.deepEqual(cachedBundle.chunks[0].docmeta.flowEvidence, real.docmeta.flowEvidence);
  assert.deepEqual(cachedBundle.chunks[0].metaV2.flowEvidence, real.docmeta.flowEvidence);
  assert.equal(cachedBundle.chunks[0].docmeta.flowEvidence.fields.dataflow.state, 'unavailable');
  assert.deepEqual(validateMetadataV2Semantics(cachedBundle.chunks[0].metaV2), []);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Managed flow excludes template output, comment/string contents and nested owners while retaining native syntax facts.');
