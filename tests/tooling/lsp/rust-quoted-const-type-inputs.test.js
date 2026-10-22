import assert from 'node:assert/strict';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { findTopLevelWord } from '../../../src/index/tooling/signature-parse/shared.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, buildLspRequestCacheKey, LSP_REQUEST_CACHE_POLICY_VERSION,
  buildSignatureParseCacheKey, readRequestCacheEntry, writeRequestCacheEntry } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only: existing generic parser/cache/document consumers; no rustc,
// rust-analyzer, constant evaluation or source function execution.
const parse = detail => parseGenericSignature(detail, 'rust');
const signature = 'fn f<T>(value: [u8; { "a  b".len() }]) -> [u8; { "c  where d".len() }] where T: Copy';
const parsed = parse(signature);
assert.equal(parsed.paramTypes.value, '[u8; { "a  b".len() }]');
assert.equal(parsed.returnType, '[u8; { "c  where d".len() }]');
assert.equal(parse('fn f(value: [u8; { "a  b".len() }]) -> [u8; { "c  d".len() }]').returnType, '[u8; { "c  d".len() }]');
assert.equal(parse("fn life<'a, T>(value: &'a T) -> &'a T where T: Copy").returnType, "&'a T");
assert.equal(parse('fn f() -> somewhere::Type').returnType, 'somewhere::Type');
assert.equal(parse('fn f() -> module::r#where').returnType, 'module::r#where');
assert.equal(findTopLevelWord('Shape<"where"> where T: Trait', 'where'), 15);
assert.equal(findTopLevelWord('somewhere::Type', 'where'), -1);
assert.equal(findTopLevelWord('module::r#where', 'where'), -1);
assert.equal(findTopLevelWord('where世界', 'where'), -1);
for (const identifier of ['𝒜where', 'where𝒜', 'a𝒜where', 'where𝒜a']) {
  assert.equal(findTopLevelWord(identifier, 'where'), -1, 'astral identifier neighbors are complete Unicode code points');
  assert.equal(parse(`fn f() -> ${identifier}`).returnType, identifier, 'an astral identifier cannot become a where clause');
}
assert.throws(() => findTopLevelWord('value', ''), /syntax word/);
const single = signature.replaceAll('  ', ' ');
assert.notEqual(buildSignatureParseCacheKey({ detailText: signature }), buildSignatureParseCacheKey({ detailText: single }));
assert.notEqual(LSP_REQUEST_CACHE_POLICY_VERSION, 'rq9');
const entries = new Map(), cacheKey = buildLspRequestCacheKey({ virtualPath: 'const.rs', docHash: 'rust-const-source',
  requestKind: 'hover', position: { line: 0, character: 0 }, generation: 'rust-quoted-const' });
writeRequestCacheEntry({ requestCacheEntries: entries, cacheKey, requestKind: 'hover', info: parsed });
const cached = readRequestCacheEntry({ requestCacheEntries: entries, cacheKey, requestKind: 'hover' });
assert.equal(cached.info.returnType, parsed.returnType);
assert.equal(cached.info.paramTypes.value[0].type, parsed.paramTypes.value);

const parseCache = new Map(), seen = [];
const parser = detail => { seen.push(detail); return parse(detail); };
parser.isSymbolSensitive = false;
const enrich = async (detail, index) => {
  const virtualPath = `const-${index}.rs`, chunkUid = `const-${index}`, byChunkUid = {};
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const target = { virtualRange: { start: 0, end: 1 }, chunkRef: { chunkUid, file: virtualPath }, symbolHint: { name: 'f', kind: 'function' } };
  await processDocumentTypes({ doc: { virtualPath, text: 'f', languageId: 'rust', docHash: 'rust-quoted-const-source' }, cmd: 'rust-quoted-const-fixture',
    client: { notify() {}, async request(method) { assert.equal(method, 'textDocument/documentSymbol');
      return [{ name: 'f', kind: 12, detail, range, selectionRange: range }]; } },
    guard: { isOpen: () => false, run: async fn => fn({ timeoutMs: 1000 }) }, log: () => {}, strict: true, parseSignature: parser,
    uri: `poc-vfs:///${virtualPath}`, languageId: 'rust', openDocs: new Map(),
    targetIndexesByPath: new Map([[virtualPath, buildTargetLookupIndex([target])]]), byChunkUid, signatureParseCache: parseCache,
    hoverEnabled: false, semanticTokensEnabled: false, signatureHelpEnabled: false, inlayHintsEnabled: false,
    definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false, hoverRequireMissingReturn: true,
    requestCacheEntries: new Map(), requestCachePersistedKeys: new Set(), hoverControl: { disabledGlobal: false },
    hoverFileStats: new Map(), hoverLatencyMs: [], hoverMetrics: createEmptyHoverMetricsResult(), checks: [], checkFlags: {} });
  return byChunkUid[chunkUid].payload;
};
const cold = await enrich(signature, 0), different = await enrich(single, 1), warm = await enrich(signature, 2);
assert.equal(cold.paramTypes.value[0].type, '[u8;{"a  b".len()}]');
assert.equal(cold.returnType, '[u8;{"c  where d".len()}]');
assert.equal(different.returnType, '[u8;{"c where d".len()}]');
assert.deepEqual(warm, cold);
assert.deepEqual(seen, [signature, single]);
console.log('Rust ordinary quoted const types retain literal identity and actual where-clause boundaries');
