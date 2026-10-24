import assert from 'node:assert/strict';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, normalizeParamTypes, mergeSignatureInfo,
  isIncompleteTypePayload, buildLspRequestCacheKey, readRequestCacheEntry, writeRequestCacheEntry } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Every dynamic-name signature adapter uses the existing own-data
// setter, preserving ordinary record shape and JSON representations.
const cases=[
  ['python','def f(__proto__: str, constructor: int) -> str','str'],
  ['cpp','int f(int __proto__, bool constructor)','int'],
  ['java','public int f(int __proto__, boolean constructor)','int'],
  ['swift','func f(__proto__: Int, constructor: String) -> Bool','Int'],
  ['go','func f(__proto__ int, constructor string) bool','int'],
  ['rust','fn f(__proto__: i32, constructor: bool) -> i32','i32'],
  ['zig','fn f(__proto__: i32, constructor: bool) i32','i32'],
  ['lua','function f(__proto__: string, constructor: number): string','string'],
  ['ruby','f(__proto__: String, constructor: Integer) -> String','String'],
  ['elixir','f(__proto__ :: binary(), constructor :: integer()) :: boolean()','binary()']
];
for (const [language,detail,type] of cases) {
  const parsed=parseGenericSignature(detail,language,'f');
  assert.ok(Object.hasOwn(parsed.paramTypes,'__proto__'),language);
  assert.ok(Object.hasOwn(parsed.paramTypes,'constructor'),language);
  assert.equal(parsed.paramTypes.__proto__,type,language);
  assert.equal(Object.getPrototypeOf(parsed.paramTypes),Object.prototype,language);
  assert.equal(JSON.parse(JSON.stringify(parsed.paramTypes)).__proto__,type,language);
}
const own=JSON.parse('{"__proto__":"str","constructor":"int","toString":"bool"}');
const normalized=normalizeParamTypes(own,{languageId:'python'});
assert.deepEqual(Object.keys(normalized),Object.keys(own));
assert.equal(Object.getPrototypeOf(normalized),Object.prototype);
for (const name of Object.keys(own)) assert.equal(normalized[name][0].type,own[name]);
const inherited=Object.create(own);
const unknown={signature:'f(__proto__, constructor, toString)',returnType:'str',paramNames:Object.keys(own),paramTypes:inherited};
assert.equal(isIncompleteTypePayload(unknown,{symbolKind:12}).missingParamTypes,true,'inherited property values are not supplied parameter types');
assert.equal(isIncompleteTypePayload({...unknown,paramTypes:{}},{symbolKind:12}).paramCoverage,0);
assert.equal(isIncompleteTypePayload({...unknown,paramTypes:normalized},{symbolKind:12}).missingParamTypes,false);
assert.equal(normalizeParamTypes({value:[{type:{invalid:true}},{type:7}]}),null,'non-string type payloads cannot become typed evidence by coercion');
const merged=mergeSignatureInfo(unknown,{signature:'f(__proto__: str, constructor: int, toString: bool)',
  returnType:'str',paramNames:Object.keys(own),paramTypes:normalized});
for (const name of Object.keys(own)) assert.ok(Object.hasOwn(merged.paramTypes,name));
assert.equal(Object.getPrototypeOf(merged.paramTypes),Object.prototype);
const entries=new Map(),cacheKey=buildLspRequestCacheKey({generation:'prototype-world',virtualPath:'proto.py',docHash:'source',
  requestKind:'hover',position:{line:0,character:4}});
writeRequestCacheEntry({requestCacheEntries:entries,cacheKey,requestKind:'hover',info:merged});
const cached=readRequestCacheEntry({requestCacheEntries:entries,cacheKey,requestKind:'hover'});
assert.equal(cached.info.paramTypes.__proto__[0].type,'str');
assert.ok(Object.hasOwn(cached.info.paramTypes,'__proto__'));

const text='def f(__proto__, constructor):\n  return __proto__\n',virtualPath='proto.py',uri='poc-vfs:///proto.py',chunkUid='proto-chunk';
const detail=cases[0][1],byChunkUid={},target={virtualRange:{start:0,end:text.length},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'f',kind:'function'}};
await processDocumentTypes({doc:{virtualPath,text,languageId:'python',docHash:'prototype-source'},cmd:'prototype-fixture',
  client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return [{name:'f',kind:12,detail,
    range:{start:{line:0,character:0},end:{line:2,character:0}},selectionRange:{start:{line:0,character:4},end:{line:0,character:5}}}];}},
  guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,parseSignature:parseGenericSignature,
  uri,languageId:'python',openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),
  byChunkUid,signatureParseCache:new Map(),hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,inlayHintsEnabled:false,
  definitionEnabled:false,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
  requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),
  hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),checks:[],checkFlags:{}});
const payload=byChunkUid[chunkUid].payload;
assert.ok(Object.hasOwn(payload.paramTypes,'__proto__'));
assert.equal(payload.paramTypes.__proto__[0].type,'str');
const metadata=buildMetaV2({chunk:{file:virtualPath,start:0,end:text.length,kind:'FunctionDeclaration'},
  docmeta:{inferredTypes:{params:payload.paramTypes}}});
assert.ok(Object.hasOwn(metadata.types.tooling.params,'__proto__'));
assert.equal(metadata.types.tooling.params.__proto__[0].type,'str','existing public metadata consumer retains the actual enriched parameter');
assert.equal(JSON.parse(JSON.stringify(metadata)).types.tooling.params.__proto__[0].type,'str');
console.log('own prototype-shaped parameter names survive parser, merge, cache, enrichment and public metadata');
