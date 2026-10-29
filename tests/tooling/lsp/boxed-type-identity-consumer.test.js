import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { buildJsChunks } from '../../../src/lang/javascript/chunks.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { resolveRecordCandidate } from '../../../src/integrations/tooling/providers/lsp/hover-types/merge.js';
import { normalizeProviderPayload } from '../../../src/index/tooling/provider-output-contract.js';
import { applyToolingTypes } from '../../../src/index/type-inference-crossfile/tooling-types.js';
import { filterChunks } from '../../../src/retrieval/output.js';
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';
import { assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();

const types = ['Boolean', 'boolean', 'String', 'string', 'Number', 'number', 'Boolean | boolean', '"a  b"', '"a b"'];
const text = types.map((type, index) => `function f${index}(value: ${type}): ${type} { return value; }`).join('\n');
const source = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
assert.deepEqual(source.parseDiagnostics, []);
const annotations = source.statements.map(node => ({ name: node.name.text, returnType: node.type.getText(source),
  paramType: node.parameters[0].type.getText(source), start: node.getStart(source), end: node.end }));
assert.deepEqual(annotations.map(row => row.returnType), types, 'the compiler syntax oracle retains boxed, primitive, union and literal identity');
const lang = getLanguageForFile('.ts', 'fixture.ts'), options = { treeSitter: { enabled: false }, javascript: { parser: 'babel' } };
const context = await lang.prepare({ text, ext: '.ts', relPath: 'fixture.ts', mode: 'code', options });
const chunks = buildJsChunks(text, { ...options, ext: '.ts', ast: context.jsAst });
await prepareChunkIds({ chunks, text, relKey: 'fixture.ts', containerExt: '.ts', containerLanguageId: 'typescript',
  lineIndex: buildLineIndex(text), vfsManifestConcurrency: 1, strict: true });
assert.equal(chunks.length, types.length);
const byChunkUid = new Map();
for (const annotation of annotations) {
  const chunk = chunks.find(row => row.name === annotation.name);
  assert.equal(chunk.start, annotation.start); assert.equal(chunk.end, annotation.end);
  chunk.docmeta = lang.extractDocMeta({ text, chunk, context });
  const candidate = await resolveRecordCandidate({ record: {
    target: { chunkRef: { chunkUid: chunk.chunkUid, file: 'fixture.ts', range: { start: chunk.start, end: chunk.end } } },
    symbol: { name: annotation.name, kind: 12 }, hoverSucceeded: true,
    info: { signature: text.slice(chunk.start, text.indexOf('{', chunk.start)), returnType: annotation.returnType,
      paramNames: ['value'], paramTypes: { value: annotation.paramType } }
  }, recordIndex: byChunkUid.size, strict: true, cmd: 'source-qualified-provider-fixture', languageId: 'typescript',
  hoverMetrics: {}, unresolvedRate: 0, stabilityTier: 'stable', providerConfidenceBias: 0 });
  candidate.payload = normalizeProviderPayload(candidate.payload);
  assert.equal(candidate.payload.returnType, annotation.returnType);
  assert.deepEqual(candidate.payload.paramTypes.value.map(row => row.type), [annotation.paramType]);
  assert.deepEqual(normalizeProviderPayload(candidate.payload), candidate.payload, 'provider normalization is stable');
  byChunkUid.set(chunk.chunkUid, candidate);
}
applyToolingTypes({ byChunkUid, chunkByUid: new Map(chunks.map(chunk => [chunk.chunkUid, chunk])) });
const matched = rows => {
  rows.forEach((row, id) => { row.id = id; });
  const index = buildFilterIndex(rows);
  return types.map(type => filterChunks(rows, { returnType: type }, index).map(row => row.name));
};
assert.deepEqual(matched(chunks), types.map((_, index) => ['f' + index]));
const payloads = chunks.map(chunk => assembleFlowFixture({ text, chunk, docmeta: chunk.docmeta, lang: 'typescript', ext: '.ts' }));
assert.deepEqual(matched(payloads), types.map((_, index) => ['f' + index]));
const root = await createImportResolutionTempRoot('boxed-type-identity-consumer');
try {
  const absPath = path.join(root, 'fixture.ts'); await fs.writeFile(absPath, text);
  const stat = await fs.stat(absPath), bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
  manifest.files['fixture.ts'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: 'fixture.ts',
    fileStat: stat, fileHash: sha1(text), fileChunks: payloads, bundleFormat: 'json', fileRelations: {} });
  const { cachedBundle } = await readCachedBundle({ enabled: true, absPath, relKey: 'fixture.ts', fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
  assert.deepEqual(matched(cachedBundle.chunks), types.map((_, index) => ['f' + index]));
  for (const [index, chunk] of cachedBundle.chunks.entries()) {
    assert.deepEqual(chunk.docmeta.inferredTypes.params.value.map(row => row.type), [types[index]]);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Compiler-qualified boxed and primitive identities survive provider normalization, tooling, strict filters and actual incremental replay.');
