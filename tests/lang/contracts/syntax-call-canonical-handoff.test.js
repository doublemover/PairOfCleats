import assert from 'node:assert/strict';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { attachCallDetailsByChunkIndex } from '../../../src/index/build/file-processor/process-chunks/dedupe.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { attachSyntaxCallFacts, syntaxRelationsForChunks } from '../../../src/lang/tree-sitter/call-facts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = '// Unicode source 😀\n' + Array.from({ length: 110 }, (_, index) =>
  `def f${index}(): Int = g${index}()`).join('\n') + '\n';
const input = { text, ext: '.scala', relPath: 'calls.scala', mode: 'code', options: {
  treeSitter: { enabled: true, strict: true, chunkCache: false, adaptive: false },
  astDataflowEnabled: false, controlFlowEnabled: false
} };
const { lang, context } = await buildLanguageContext(input);
const raw = lang.buildRelations({ ...input, context });
const filtered = filterRawRelationsWithLexicon(raw, { languageId: 'scala', relKey: input.relPath });
assert.equal(filtered.callDetails.length, 110);
const chunks = context.scalaChunks.map((chunk, id) => ({ ...chunk, id,
  file: input.relPath, lang: 'scala', chunkUid: `fixture-call-owner-${id}` }));
const index = buildCallIndex(filtered);
attachCallDetailsByChunkIndex(index, chunks);
for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
  const chunk = chunks[chunkIndex];
  chunk.codeRelations = buildChunkRelations({ lang, chunk, fileRelations: filtered, callIndex: index, chunkIndex });
}
const sites = createCallSites({ chunks });
assert.equal(sites.length, 110, 'canonical writer must retain every supported occurrence, beyond the old 96 cutoff');
assert.equal(new Set(sites.map(site => site.callSiteId)).size, 110);
assert.equal(validateArtifact('call_sites', sites).ok, true);
for (const site of sites) {
  const source = text.slice(site.start, site.end);
  assert.ok(source.startsWith(site.calleeRaw));
  assert.equal(site.extensions.syntax.coordinateSystem, 'utf16');
  assert.equal(site.extensions.syntax.resolution, 'unresolved');
  assert.ok(site.startLine > 1 && site.startCol > 0 && site.endCol > site.startCol);
}
const nativeFact = context.scalaChunks.flatMap(chunk => chunk.meta?.syntaxCalls || [])[0];
assert.ok(Object.isFrozen(nativeFact));
assert.ok(!Object.isFrozen(filtered.callDetails[0]));
filtered.callDetails[0].targetChunkUid = 'later-resolution';
assert.equal(nativeFact.targetChunkUid, undefined, 'resolution annotations cannot mutate the parser snapshot');

// A grammar-role unit isolates dynamic invocation preservation, including a
// non-BMP prefix. The real native adapter path above owns parser qualification.
const dynamicText = '😀\nobj[index]()';
const callee = { type: 'subscript_expression', startIndex: 3, endIndex: 13, namedChildren: [] };
const call = { type: 'call_expression', startIndex: 3, endIndex: dynamicText.length,
  childForFieldName: name => name === 'function' ? callee : null, namedChildren: [callee] };
const root = { type: 'program', startIndex: 0, endIndex: dynamicText.length, namedChildren: [call] };
const owner = { name: 'owner', kind: 'FunctionDeclaration', start: 0, end: dynamicText.length, meta: {} };
attachSyntaxCallFacts(root, dynamicText, [owner], { declarations: new Map([['0:' + dynamicText.length, owner]]) });
const dynamic = filterRawRelationsWithLexicon(syntaxRelationsForChunks([owner]), { languageId: 'javascript' });
assert.deepEqual(dynamic.calls, []);
assert.equal(dynamic.callDetails.length, 1);
const [site] = createCallSites({ chunks: [{ ...owner, file: 'dynamic.js', lang: 'javascript',
  chunkUid: 'dynamic-owner', codeRelations: dynamic }] });
assert.ok(site);
assert.equal(site.startLine, 2); assert.equal(site.startCol, 1);
assert.equal(site.calleeRaw, 'obj[index]');
assert.equal(site.extensions.syntax.reason, 'dynamic-call-target');
assert.equal(validateArtifact('call_sites', [site]).ok, true);
console.log('Immutable native syntax facts reach mutable relation annotations and canonical occurrence rows.');
