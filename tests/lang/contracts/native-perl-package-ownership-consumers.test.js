import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildLanguageContext, buildChunkRelations } from '../../../src/index/language-registry.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { prepareChunkIds } from '../../../src/index/build/file-processor/process-chunks/ids.js';
import { buildLineIndex, offsetToLine } from '../../../src/shared/lines.js';
import { buildCallIndex } from '../../../src/index/build/file-processor/relations.js';
import { filterRawRelationsWithLexicon } from '../../../src/index/build/file-processor/lexicon-relations-filter.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('lang/contracts/native-perl-package-ownership-consumers/')[1];
assert.ok(['braced', 'unbraced', 'nested'].includes(selected));
const source = selected === 'unbraced' ? 'package Demo;\nsub callee { return 1; }\nsub caller { callee(); }\n'
  : selected === 'nested' ? 'package Demo {\nsub outer { sub helper { return 1; } helper(); }\n}\n'
    : 'package Demo {\nsub callee { return 1; }\nsub caller { callee(); }\n}\n';
const expected = selected === 'unbraced' ? ['callee', 'caller'] : selected === 'nested' ? ['Demo.outer', 'Demo.outer.helper']
  : ['Demo.callee', 'Demo.caller'];
const parser = getNativeTreeSitterParser('perl'); assert.ok(parser, 'actual patched locked Perl parser is required');
const tree = parser.parse(source);
try { assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString()); } finally { tree.delete?.(); parser.reset?.(); }
let prior;
for (const useQueries of [false, true]) {
  const options = { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false, useQueries },
    astDataflowEnabled: false, controlFlowEnabled: false };
  const queryBefore = treeSitterState.metrics.queryExecutions || 0;
  const input = { text: source, ext: '.pl', relPath: 'fixture.pl', mode: 'code', options };
  const { lang, context } = await buildLanguageContext(input), native = context.perlChunks;
  assert.ok(native?.length); assert.ok(native.some(chunk => chunk.kind === 'PackageDeclaration' && chunk.name === 'Demo'));
  assert.deepEqual(native.filter(chunk => chunk.kind === 'FunctionDeclaration').map(chunk => chunk.name), expected);
  assert.equal(native.some(chunk => chunk.kind === 'MethodDeclaration'), false,
    'a lexical package is not a semantic type; the old braced-kind defect must fail this independent oracle');
  if (useQueries) assert.ok((treeSitterState.metrics.queryExecutions || 0) > queryBefore, 'the actual native Query route executes');
  const raw = lang.buildRelations({ ...input, context });
  const filtered = filterRawRelationsWithLexicon(raw, { languageId: lang.id, relKey: input.relPath });
  for (const name of expected) assert.ok(filtered.exports.includes(name), 'free sub export: ' + name);
  const caller = selected === 'nested' ? expected[0] : expected[1], target = selected === 'nested' ? 'helper' : 'callee';
  assert.ok(filtered.calls.some(([owner, callee]) => owner === caller && callee === target));
  const chunks = smartChunk({ ...input, context });
  const lineIndex = buildLineIndex(source);
  const ids = await prepareChunkIds({ chunks, text: source, relKey: input.relPath, containerExt: '.pl', containerLanguageId: 'perl',
    lineIndex, vfsManifestConcurrency: 1, strict: true });
  assert.equal(new Set(chunks.map(chunk => chunk.chunkUid)).size, chunks.length);
  const index = buildCallIndex(filtered);
  for (const [chunkIndex, chunk] of chunks.entries()) {
    chunk.file = input.relPath; chunk.lang = 'perl';
    chunk.codeRelations = buildChunkRelations({ lang, chunk, fileRelations: filtered, callIndex: index });
    assert.equal(ids.chunkLineRanges[chunkIndex].startLine, offsetToLine(lineIndex, chunk.start));
    assert.equal(ids.chunkLineRanges[chunkIndex].endLine, offsetToLine(lineIndex, Math.max(chunk.start, chunk.end - 1)));
    if (!expected.includes(chunk.name)) continue;
    assert.equal(chunk.kind, 'FunctionDeclaration'); assert.ok(source.slice(chunk.start, chunk.end).includes('sub '));
    const docmeta = enrichFlowFixture({ text: source, chunk, lang, options, enabled: false });
    const payload = assembleFlowFixture({ text: source, chunk, docmeta, lang: lang.id, ext: '.pl', emitFieldTokens: true });
    assert.equal(payload.name, chunk.name); assert.equal(payload.kind, 'FunctionDeclaration');
  }
  const projectedCaller = chunks.find(chunk => chunk.name === caller);
  assert.ok(projectedCaller.codeRelations.calls.some(([owner, callee]) => owner === caller && callee === target));
  const sites = createCallSites({ chunks });
  assert.ok(sites.some(site => site.calleeRaw === target || site.calleeNormalized === target), 'the original invocation survives canonical call-site projection');
  const identity = chunks.filter(chunk => expected.includes(chunk.name)).map(chunk => ({ name: chunk.name, kind: chunk.kind,
    start: chunk.start, end: chunk.end, uid: chunk.chunkUid }));
  if (prior) assert.deepEqual(identity, prior, 'query/walk preserve source ranges and canonical UID identity'); prior = identity;
}
console.log(JSON.stringify({ selected, sourceSha256: createHash('sha256').update(source).digest('hex'), expected, identity: prior }));
