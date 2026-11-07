import assert from 'node:assert/strict';
import { findMatchingParen, splitTopLevel } from '../../../src/index/tooling/signature-parse/shared.js';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { canonicalizeTypeText } from '../../../src/shared/type-normalization.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, isIncompleteTypePayload } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. These use the existing production parser dispatch and actual
// document-processing consumer with an inert protocol client, not a native run.
const cases=[
  ['swift','func f(separator: String = ")", handler: Result<(Int) -> Void, Error>) -> Bool',
    {separator:'String',handler:'Result<(Int) -> Void, Error>'},'Bool'],
  ['zig','fn f(value: @TypeOf("a  b)"), count: usize) bool',
    {value:'@TypeOf("a  b)")',count:'usize'},'bool'],
  ['elixir',String.raw`f(text :: String.t() \\ ")", count :: integer()) :: boolean()`,
    {text:'String.t()',count:'integer()'},'boolean()'],
  ['ruby','f(value : String, count : Integer) -> Proc(Integer)',
    {value:'String',count:'Integer'},'Proc(Integer)'],
  ['lua','function f(value: string, count: number): fun(arg: string): number',
    {value:'string',count:'number'},'fun(arg: string): number'],
  ['cpp','int f(Tag<")"> value, int count) { bodyCall(); }',
    {value:'Tag<")">',count:'int'},'int'],
  ['java','public int f(int value, int count) { bodyCall(); }',
    {value:'int',count:'int'},'int']
];
for (const [language,detail,paramTypes,returnType] of cases) {
  const parsed=parseGenericSignature(detail,language,'f');
  assert.deepEqual(parsed.paramTypes,paramTypes,language);
  assert.deepEqual(parsed.paramNames,Object.keys(paramTypes),language);
  assert.equal(parsed.returnType,returnType,language);
  assert.equal(isIncompleteTypePayload(parsed,{symbolKind:12}).missingParamTypes,false,language);
  const name=detail.indexOf('f('),virtualPath=`enclosure.${language}`,uri=`poc-vfs:///${virtualPath}`,chunkUid=`enclosure-${language}`;
  assert.ok(name>=0);
  const target={virtualRange:{start:0,end:detail.length},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'f',kind:'function'}},byChunkUid={};
  await processDocumentTypes({doc:{virtualPath,text:detail,languageId:language,docHash:'enclosure-source'},cmd:'enclosure-fixture',
    client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return [{name:'f',kind:12,detail,
      range:{start:{line:0,character:0},end:{line:0,character:detail.length}},
      selectionRange:{start:{line:0,character:name},end:{line:0,character:name+1}}}];}},
    guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,parseSignature:parseGenericSignature,
    uri,languageId:language,openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),
    byChunkUid,signatureParseCache:new Map(),hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,
    inlayHintsEnabled:false,definitionEnabled:false,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
    requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),
    hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),checks:[],checkFlags:{}});
  const payload=byChunkUid[chunkUid].payload;
  assert.equal(payload.returnType,canonicalizeTypeText(returnType,{languageId:language}).displayText,language);
  for (const [parameter,type] of Object.entries(paramTypes)) assert.equal(payload.paramTypes[parameter][0].type,
    canonicalizeTypeText(type,{languageId:language}).displayText,language+':'+parameter);
}
assert.equal(findMatchingParen('f(")")',1),5);
assert.equal(findMatchingParen('f(")"',1),-1,'a quoted close cannot finish an unclosed parameter enclosure');
assert.equal(findMatchingParen('f([value)',1),-1);
assert.equal(findMatchingParen('f(value)',0),-1);
const comparison='f(value = 1 < 2)';
assert.equal(findMatchingParen(comparison,1),comparison.length-1,'angle operators do not govern the outer parentheses');
for (const arrow of ['->','=>']) {
  const nested=`Result<(Int) ${arrow} Void, Error>`;
  assert.deepEqual(splitTopLevel(nested+', Tail'),[nested,'Tail'],'a type arrow cannot close a generic argument list');
}
console.log('quote-aware parameter enclosures and generic arrows reach actual provider type consumers');
