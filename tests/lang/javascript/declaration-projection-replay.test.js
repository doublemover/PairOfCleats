import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLanguageForFile, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { buildCallIndex, buildFileRelations } from '../../../src/index/build/file-processor/relations.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { enqueueFileRelationsArtifacts } from '../../../src/index/build/artifacts/writers/file-relations.js';
import { writePiecesManifest } from '../../../src/index/build/artifacts/checksums.js';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io/loaders/core.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { validateMetadataV2Semantics } from '../../../src/contracts/validators/metadata.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { sha1 } from '../../../src/shared/hash.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const lang = getLanguageForFile('.js', 'fixture.js');
const text = 'function first(value = 7) { one(value); return finish(3); }\nfunction second() { two(); return; }';
const options = { javascript: { parser: 'babel' }, treeSitter: { enabled: false }, astDataflowEnabled: true, controlFlowEnabled: true };
const context = await lang.prepare({ text, ext: '.js', relPath: 'fixture.js', mode: 'code', options });
const relations = lang.buildRelations({ text, relPath: 'fixture.js', context, options });
const chunks = buildJsChunks(text, { ...options, ast: context.jsAst });
const first = chunks.find(chunk => chunk.name === 'first'), index = buildCallIndex(relations);
const splitAt = text.indexOf('return finish');
const fragment = { ...first, end: splitAt };
const fragmentDoc = enrichFlowFixture({ text, chunk: fragment, lang, context, options, fileRelations: relations, callIndex: index, relationsEnabled: true });
assert.deepEqual(fragmentDoc.params, ['value']);
assert.equal(fragmentDoc.javascriptDeclaration.state, 'partial');
assert.equal(fragmentDoc.returnsValue, undefined, 'a retained full-owner reference cannot lend aggregate flow to a fragment');
const fragmentRelations = buildChunkRelations({ lang, chunk: fragment, fileRelations: relations, callIndex: index });
assert.deepEqual(fragmentRelations.calls, [['first', 'one']]);
assert.ok(fragmentRelations.callCoverageReasons.includes('source-fragment-projection'));
const crossing = buildChunkRelations({ lang, chunk: { ...first, end: text.indexOf('value);') + 2 }, fileRelations: relations, callIndex: index });
assert.deepEqual(crossing.calls, []);
assert.ok(crossing.callCoverageReasons.includes('split-call-occurrence'));

const prefix = '<html>😀\r\n<script>\r\n', container = prefix + text + '\r\n</script></html>', offset = prefix.length;
const cache = new Map(), lines = buildLineIndex(container), embedded = [];
for (const local of chunks) {
  const chunk = { ...local, start: local.start + offset, end: local.end + offset,
    segment: { segmentId: 'script:0', start: offset, end: offset + text.length, languageId: 'javascript' } };
  const result = enrichFlowFixture({ text: container, chunk, lang, context: {}, options, relationsEnabled: true,
    segmentRelationsCache: cache, sourceLineIndex: lines, returnResult: true });
  assert.equal(cache.size, 1, 'all chunks reuse the one segment relation product');
  assert.equal(result.docmeta.javascriptDeclaration.occurrenceId,
    lang.extractDocMeta({ text, chunk: local, fileRelations: relations, context }).javascriptDeclaration.occurrenceId);
  assert.deepEqual(result.docmeta.javascriptDeclaration.sourceMapping, { offset, length: text.length });
  assert.deepEqual(result.docmeta.flowEvidence.source.range, { start: chunk.start, end: chunk.end });
  const payload = assembleFlowFixture({ text: container, chunk, docmeta: result.docmeta, lang: 'javascript', ext: '.js', codeRelations: result.codeRelations });
  assert.deepEqual(validateMetadataV2Semantics(payload.metaV2), []);
  for (const detail of result.codeRelations.callDetails || []) {
    assert.ok(container.slice(detail.start, detail.end).startsWith(detail.callee));
    assert.equal(detail.evaluationOwner.sourceOffset, offset);
    for (const slot of detail.arguments?.slots || []) assert.ok(slot.range.start >= chunk.start && slot.range.end <= chunk.end);
    for (const literal of detail.argLiterals || []) if (literal) assert.ok(literal.range.start >= chunk.start && literal.range.end <= chunk.end);
    if (detail.returnedValue) assert.deepEqual(detail.returnedValue.expression, [detail.start, detail.end]);
  }
  embedded.push(payload);
}
assert.equal(embedded[0].docmeta.paramDefaultLiterals.value.range.start, container.indexOf('7'));
assert.equal(embedded[0].docmeta.returnsValue, true);
assert.equal(embedded[1].docmeta.returnsValue, false);
const sites = createCallSites({ chunks: embedded }), sitesCheck = validateArtifact('call_sites', sites);
assert.equal(sitesCheck.ok, true, sitesCheck.errors.join('; '));
assert.deepEqual(sites.map(row => row.calleeNormalized).sort(), ['finish', 'one', 'two']);
const invalidMapping = structuredClone(embedded[0].metaV2); invalidMapping.javascriptDeclaration.sourceMapping.offset++;
assert.ok(validateMetadataV2Semantics(invalidMapping).length);

const file = buildFileRelations(relations, 'fixture.js');
const invalidIdentity = structuredClone(file); Object.values(invalidIdentity.jsDeclarations.records)[0].role = 'another-role';
assert.equal(validateArtifact('file_relations', [{ file: 'fixture.js', relations: invalidIdentity }]).ok, false);
const invalidAlias = structuredClone(file); invalidAlias.jsDeclarations.rangeOwners['0:1'] = [first.meta.jsDeclaration.id];
assert.equal(validateArtifact('file_relations', [{ file: 'fixture.js', relations: invalidAlias }]).ok, false);
const root = await createImportResolutionTempRoot('javascript-declaration-replay');
try {
  const records = new Map(Array.from({ length: 4 }, (_, i) => [`fixture-${i}.js`, file]));
  const entryBytes = Buffer.byteLength(JSON.stringify({ file: 'fixture-0.js', relations: file }));
  for (const maxJsonBytes of [entryBytes * 8, entryBytes + 512]) {
    const outDir = path.join(root, `artifacts-${maxJsonBytes}`); await fs.mkdir(outDir);
    const writes = [], pieces = [];
    enqueueFileRelationsArtifacts({ state: { fileRelations: records }, outDir, maxJsonBytes,
      enqueueWrite: (_label, write) => writes.push(write), formatArtifactLabel: value => value,
      addPieceFile: (entry, name) => pieces.push({ ...entry, path: path.relative(outDir, name).replaceAll('\\', '/') }) });
    for (const write of writes) await write();
    assert.ok(pieces.some(piece => piece.name === (maxJsonBytes === entryBytes * 8 ? 'file_relations' : 'file_relations_meta')));
    await writePiecesManifest({ pieceEntries: pieces, outDir, mode: 'code', indexState: { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, buildId: 'js-declarations' } });
    const loaded = await loadJsonArrayArtifact(outDir, 'file_relations', { strict: true });
    const validation = validateArtifact('file_relations', loaded); assert.equal(validation.ok, true, validation.errors.join('; '));
    assert.deepEqual(JSON.parse(JSON.stringify(loaded[0].relations.jsDeclarations)), JSON.parse(JSON.stringify(file.jsDeclarations)));
  }
  const absPath = path.join(root, 'fixture.js'); await fs.writeFile(absPath, text);
  const stat = await fs.stat(absPath), bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  const docmeta = enrichFlowFixture({ text, chunk: first, lang, context, options, fileRelations: relations, callIndex: index, relationsEnabled: true });
  const payload = assembleFlowFixture({ text, chunk: first, docmeta, lang: 'javascript', ext: '.js', codeRelations: buildChunkRelations({ lang, chunk: first, fileRelations: relations, callIndex: index }) });
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  manifest.files['fixture.js'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: 'fixture.js',
    fileStat: stat, fileHash: sha1(text), fileChunks: [payload], bundleFormat: 'json', fileRelations: file });
  const { cachedBundle } = await readCachedBundle({ enabled: true, absPath, relKey: 'fixture.js', fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
  assert.deepEqual(cachedBundle.chunks[0].metaV2.javascriptDeclaration, payload.metaV2.javascriptDeclaration);
  assert.deepEqual(cachedBundle.chunks[0].docmeta.flowEvidence, payload.docmeta.flowEvidence);
  assert.deepEqual(JSON.parse(JSON.stringify(cachedBundle.fileRelations.jsDeclarations)), JSON.parse(JSON.stringify(file.jsDeclarations)));
  const complexText = `class Box {
    same(value = seed()) { instanceOnly(value); return value; }
    static same(other) { staticOnly(other); throw new Error(); }
    get item() { return getOnly(); }
    set item(value) { setOnly(value); }
  }
  function outer() { class Child extends baseFactory() { [key()]() { bodyOnly(); } } }
  function* generator() { return; }
  const literal = () => 42;`;
  for (const parser of ['babel', 'acorn']) {
    const currentOptions = { ...options, javascript: { parser } };
    const currentContext = await lang.prepare({ text: complexText, ext: '.js', relPath: 'fixture.js', mode: 'code', options: currentOptions });
    const currentRelations = lang.buildRelations({ text: complexText, relPath: 'fixture.js', context: currentContext, options: currentOptions });
    const currentChunks = buildJsChunks(complexText, { ...currentOptions, ast: currentContext.jsAst });
    const currentIndex = buildCallIndex(currentRelations), currentFile = buildFileRelations(currentRelations, 'fixture.js');
    const rows = currentChunks.map(chunk => {
      const docmeta = enrichFlowFixture({ text: complexText, chunk, lang, context: currentContext, options: currentOptions,
        fileRelations: currentRelations, callIndex: currentIndex, relationsEnabled: true });
      return assembleFlowFixture({ text: complexText, chunk, docmeta, lang: 'javascript', ext: '.js',
        codeRelations: buildChunkRelations({ lang, chunk, fileRelations: currentRelations, callIndex: currentIndex }) });
    });
    await fs.writeFile(absPath, complexText); const currentStat = await fs.stat(absPath);
    manifest.files['fixture.js'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: 'fixture.js',
      fileStat: currentStat, fileHash: sha1(complexText), fileChunks: rows, bundleFormat: 'json', fileRelations: currentFile });
    const { cachedBundle: restored } = await readCachedBundle({ enabled: true, absPath, relKey: 'fixture.js', fileStat: currentStat, manifest, bundleDir, bundleFormat: 'json' });
    assert.deepEqual(restored.chunks.map(row => row.docmeta), JSON.parse(JSON.stringify(rows.map(row => row.docmeta))));
    const methods = restored.chunks.filter(row => row.name === 'Box.same');
    assert.equal(methods.length, 2);
    for (const method of methods) {
      const own = method.docmeta.modifiers.static ? ['staticOnly'] : ['seed', 'instanceOnly'];
      assert.deepEqual(method.codeRelations.calls.map(([, callee]) => callee), own);
      assert.deepEqual(method.docmeta.params, method.docmeta.modifiers.static ? ['other'] : ['value']);
    }
    const outer = restored.chunks.find(row => row.name === 'outer');
    const details = outer.codeRelations.callDetails;
    assert.deepEqual(details.map(row => [row.callee, row.evaluationPhase]), [['baseFactory', 'definition-evaluation'], ['key', 'definition-evaluation']]);
    assert.equal(restored.chunks.find(row => row.name === 'generator').docmeta.modifiers.generator, true);
    assert.equal(restored.chunks.find(row => row.name === 'generator').docmeta.returnsValue, false);
    assert.equal(restored.chunks.find(row => row.name === 'literal').docmeta.returnsValue, true);
    const callSites = createCallSites({ chunks: restored.chunks });
    assert.equal(validateArtifact('call_sites', callSites).ok, true);
    const staticOwner = methods.find(row => row.docmeta.modifiers.static).docmeta.javascriptDeclaration.occurrenceId;
    assert.deepEqual(callSites.filter(row => row.extensions.javascriptEvaluation.occurrenceId === staticOwner).map(row => row.calleeNormalized), ['staticOnly', 'Error']);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('JavaScript declaration ownership survives fragments, embedded offsets, canonical artifacts and incremental replay.');
