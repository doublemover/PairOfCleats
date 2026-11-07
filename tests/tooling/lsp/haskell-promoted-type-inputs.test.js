import assert from 'node:assert/strict';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, buildLspRequestCacheKey, LSP_REQUEST_CACHE_POLICY_VERSION,
  buildSignatureParseCacheKey, readRequestCacheEntry, writeRequestCacheEntry } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Provider type strings pass through the actual parser dispatch,
// request-cache normalization and document consumer; no HLS/GHC process executes.
const parse = detail => parseGenericSignature(detail, 'haskell');
const signature = 'f :: Proxy "a  -> b" -> Proxy "c  => d"';
const first = parse(signature);
assert.equal(first.paramTypes.arg1, 'Proxy "a  -> b"');
assert.equal(first.returnType, 'Proxy "c  => d"');
assert.equal(parse('f :: Proxy "x => y" -> Int').paramTypes.arg1, 'Proxy "x => y"');
assert.equal(parse('f :: forall a. (KnownSymbol "x => y", Eq a) => Proxy "x" -> a').paramTypes.arg1, 'Proxy "x"');
assert.equal(parse('f :: forall (a :: Proxy "dot.inside"). Proxy a -> Int').paramTypes.arg1, 'Proxy a');
for (const type of ["Proxy 'True", "Proxy '[Int, Bool]", "Proxy '(Int, Bool)", "Proxy ' A'", "a'", "Proxy '>'",
  String.raw`Proxy '\x3e'`, String.raw`Proxy '\NUL'`, String.raw`Proxy '\''`]) {
  const result = parse(`f :: ${type} -> Int`);
  assert.deepEqual(result.paramNames, ['arg1'], 'a promotion or identifier tick cannot hide the function arrow');
  assert.equal(result.paramTypes.arg1, type);
  assert.equal(result.returnType, 'Int');
}
assert.deepEqual(parse('f :: Proxy \'True -> Proxy \'False').paramNames, ['arg1']);
assert.deepEqual(parse('f :: (a -> b) -> a -> b').paramNames, ['arg1', 'arg2']);
assert.equal(parse('f :: (a -> b) -> a -> b').paramTypes.arg1, '(a -> b)');
const single = signature.replaceAll('  ', ' ');
assert.notEqual(buildSignatureParseCacheKey({ detailText: signature }), buildSignatureParseCacheKey({ detailText: single }));
assert.ok(LSP_REQUEST_CACHE_POLICY_VERSION.startsWith('rq'));
assert.notEqual(LSP_REQUEST_CACHE_POLICY_VERSION, 'rq8', 'old Haskell parse results must not survive admission changes');
const entries = new Map(), cacheKey = buildLspRequestCacheKey({ virtualPath: 'types.hs', docHash: 'haskell-source',
  requestKind: 'hover', position: { line: 0, character: 0 }, generation: 'haskell-promoted' });
writeRequestCacheEntry({ requestCacheEntries: entries, cacheKey, requestKind: 'hover', info: first });
const cached = readRequestCacheEntry({ requestCacheEntries: entries, cacheKey, requestKind: 'hover' });
assert.equal(cached.info.paramTypes.arg1[0].type, first.paramTypes.arg1);
assert.equal(cached.info.returnType, first.returnType);

const parseCache = new Map(), seen = [];
const parser = detail => { seen.push(detail); return parse(detail); };
parser.isSymbolSensitive = false;
const enrich = async (detail, index) => {
  const virtualPath = `promoted-${index}.hs`, chunkUid = `promoted-${index}`, byChunkUid = {};
  const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
  const target = { virtualRange: { start: 0, end: 1 }, chunkRef: { chunkUid, file: virtualPath }, symbolHint: { name: 'f', kind: 'function' } };
  await processDocumentTypes({ doc: { virtualPath, text: 'f', languageId: 'haskell', docHash: 'haskell-promoted-source' }, cmd: 'haskell-promoted-fixture',
    client: { notify() {}, async request(method) { assert.equal(method, 'textDocument/documentSymbol');
      return [{ name: 'f', kind: 12, detail, range, selectionRange: range }]; } },
    guard: { isOpen: () => false, run: async fn => fn({ timeoutMs: 1000 }) }, log: () => {}, strict: true, parseSignature: parser,
    uri: `poc-vfs:///${virtualPath}`, languageId: 'haskell', openDocs: new Map(),
    targetIndexesByPath: new Map([[virtualPath, buildTargetLookupIndex([target])]]), byChunkUid, signatureParseCache: parseCache,
    hoverEnabled: false, semanticTokensEnabled: false, signatureHelpEnabled: false, inlayHintsEnabled: false,
    definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false, hoverRequireMissingReturn: true,
    requestCacheEntries: new Map(), requestCachePersistedKeys: new Set(), hoverControl: { disabledGlobal: false },
    hoverFileStats: new Map(), hoverLatencyMs: [], hoverMetrics: createEmptyHoverMetricsResult(), checks: [], checkFlags: {} });
  return byChunkUid[chunkUid].payload;
};
const cold = await enrich(signature, 0), different = await enrich(single, 1), warm = await enrich(signature, 2);
assert.equal(cold.paramTypes.arg1[0].type, 'Proxy "a  -> b"');
assert.equal(cold.returnType, 'Proxy "c  => d"');
assert.equal(different.returnType, 'Proxy "c => d"');
assert.deepEqual(warm, cold);
assert.deepEqual(seen, [signature, single]);
const promoted = await enrich("f :: Proxy 'True -> Proxy 'False", 3);
assert.equal(promoted.paramTypes.arg1[0].type, "Proxy 'True");
assert.equal(promoted.returnType, "Proxy 'False");
console.log('Haskell promoted constructors, type-level literals and contexts survive actual parser/cache/document consumers');
