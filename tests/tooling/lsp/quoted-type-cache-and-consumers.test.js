import assert from 'node:assert/strict';
import { normalizeTypeWhitespace, transformTypeTextOutsideLiterals } from '../../../src/shared/type-normalization.js';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, normalizeSignatureCacheText,
  buildSignatureParseCacheKey, buildLspRequestCacheKey, LSP_REQUEST_CACHE_POLICY_VERSION,
  readRequestCacheEntry, writeRequestCacheEntry, buildSourceSignatureCandidate } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Literal payloads must survive the actual parser dispatch, cache
// admission and ordinary document enrichment, not only final canonicalization.
const signature='def literal(value: typing.Literal["typing.Foo  bar"]) -> typing.Literal["builtins.str  x"]';
const parsed=parseGenericSignature(signature,'python');
assert.equal(parsed.paramTypes.value,'Literal["typing.Foo  bar"]');
assert.equal(parsed.returnType,'Literal["builtins.str  x"]');
for (const namespace of ['custom.typing','custom . typing','世界.typing','module.builtins']) {
  const result=parseGenericSignature(`def f(x: ${namespace}.Item) -> ${namespace}.Result`,'python');
  assert.equal(result.paramTypes.x,`${namespace}.Item`);
  assert.equal(result.returnType,`${namespace}.Result`);
}
assert.equal(parseGenericSignature('def f(x: collections.abc) -> collections.abc','python').returnType,'collections.abc');
assert.equal(parseGenericSignature('def f(x: collections.abc.Sequence[str]) -> typing.Optional[builtins.str]','python').returnType,'Optional[str]');
const cpp=parseGenericSignature('static Tag<"static  inline"> read()','cpp','read');
assert.equal(cpp.returnType,'Tag<"static  inline">','qualifier syntax cleanup cannot rewrite string non-type template arguments');
const lua=parseGenericSignature('function f(value: "a  b"): "c  d"','lua');
assert.equal(lua.paramTypes.value,'"a  b"');assert.equal(lua.returnType,'"c  d"');
assert.equal(normalizeTypeWhitespace('  A  < "x  y", \'z\tq\' >  '),'A < "x  y", \'z\tq\' >');
for (const preserved of ['  Literal["unterminated', 'typing.\u00000\u0000']) {
  assert.equal(transformTypeTextOutsideLiterals(preserved,()=>{throw new Error('unsafe masked input was rewritten');}),preserved);
}
const single=signature.replaceAll('  ',' ');
assert.notEqual(normalizeSignatureCacheText(signature),normalizeSignatureCacheText(single));
assert.notEqual(buildSignatureParseCacheKey({detailText:signature}),buildSignatureParseCacheKey({detailText:single}));
assert.equal(buildSignatureParseCacheKey({detailText:' f(  x  )  '}),buildSignatureParseCacheKey({detailText:'f( x )'}));
assert.notEqual(buildSignatureParseCacheKey({parserKey:'a::b',detailText:'c'}),
  buildSignatureParseCacheKey({parserKey:'a',detailText:'b::c'}),'tuple encoding prevents delimiter collisions');
const source='function f(x: "a  b") { return x; }';
assert.equal(buildSourceSignatureCandidate(source,{start:0,end:source.length}),'function f(x: "a  b")');

const entries=new Map(),cacheKey=buildLspRequestCacheKey({generation:'quoted-world',virtualPath:'literal.py',docHash:'source',
  requestKind:'hover',position:{line:0,character:4}});
assert.ok(cacheKey.startsWith(LSP_REQUEST_CACHE_POLICY_VERSION+'|'));
writeRequestCacheEntry({requestCacheEntries:entries,cacheKey,requestKind:'hover',info:parsed});
const cached=readRequestCacheEntry({requestCacheEntries:entries,cacheKey,requestKind:'hover'});
assert.equal(cached.info.returnType,parsed.returnType);
assert.equal(cached.info.signature,signature);
assert.equal(cached.info.paramTypes.value[0].type,parsed.paramTypes.value);

const parseCache=new Map(),seen=[],limiter=async fn=>fn();
const parser=(detail,languageId)=>{seen.push(detail);return parseGenericSignature(detail,languageId);};
parser.isSymbolSensitive=false;
const enrich=async (detail,index)=>{
  const text='def literal(value):\n  return value\n',virtualPath=`literal-${index}.py`,uri=`poc-vfs:///${virtualPath}`;
  const chunkUid=`literal-${index}`,byChunkUid={},nameRange={start:{line:0,character:4},end:{line:0,character:11}};
  const target={virtualRange:{start:0,end:text.length},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'literal',kind:'function'}};
  await processDocumentTypes({doc:{virtualPath,text,languageId:'python',docHash:'quoted-source'},cmd:'quoted-fixture',
    client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return [{name:'literal',kind:12,
      range:{start:{line:0,character:0},end:{line:2,character:0}},selectionRange:nameRange,detail}];}},
    guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,parseSignature:parser,uri,languageId:'python',
    openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),byChunkUid,signatureParseCache:parseCache,
    hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,inlayHintsEnabled:false,definitionEnabled:false,
    typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,resolvedHoverMaxPerFile:1,hoverLimiter:limiter,
    requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),hoverControl:{disabledGlobal:false},
    hoverFileStats:new Map(),hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),checks:[],checkFlags:{}});
  return byChunkUid[chunkUid].payload;
};
const first=await enrich(signature,1),second=await enrich(single,2),warm=await enrich(signature,3);
assert.equal(first.returnType,'Literal["builtins.str  x"]');
assert.equal(first.paramTypes.value[0].type,'Literal["typing.Foo  bar"]');
assert.equal(second.returnType,'Literal["builtins.str x"]');
assert.deepEqual(warm,first);
assert.deepEqual(seen,[signature,single],'distinct literal values parse separately; equal input reuses the real parse cache');
console.log('quoted type identity survives parser dispatch, request admission and cold/warm document consumers');
