import assert from 'node:assert/strict';
import { canonicalizeTypeText } from '../../src/shared/type-normalization.js';
import { parseGenericSignature } from '../../src/index/tooling/lsp-provider/runtime.js';
import { buildTargetLookupIndex } from '../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, normalizeParamTypes } from '../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Prefix cleanup applies to recognized root tokens of complete
// qualified paths, never an inner member or an ASCII suffix of a Unicode name.
for (const [input,expected] of [
  ['std::vec::Vec<crate::model::Thing>','vec::Vec<model::Thing>'],
  ['std :: vec :: Vec < core :: option :: Option < alloc :: string :: String > >','vec::Vec<option::Option<string::String>>'],
  ['domain::std::Thing','domain::std::Thing'],
  ['outer :: core :: Result','outer::core::Result'],
  ['std::domain::std::Thing','domain::std::Thing'],
  ['crate::core::Thing','crate::core::Thing'],
  ['super::super::Thing','super::super::Thing'],
  ['世界std::Thing','世界std::Thing'],
  ['r#std::Thing','r#std::Thing'],
  ['::std::vec::Vec<::domain::core::Thing>','::vec::Vec<::domain::core::Thing>'],
  ['Tuple<"std::Thing  core::Other", outer::alloc::Thing>','Tuple<"std::Thing  core::Other", outer::alloc::Thing>']
]) {
  assert.equal(canonicalizeTypeText(input,{languageId:'rust'}).displayText,expected,input);
  assert.equal(canonicalizeTypeText(expected,{languageId:'rust'}).displayText,expected,'repeated passes retain '+input);
}
for (const [input,expected] of [
  ['global::System.Collections.Generic.List<global::MyApp.Widget>','System.Collections.Generic.List<MyApp.Widget>'],
  ['global :: System.String','System.String'],
  ['世界global::Thing','世界global::Thing'],
  ['local.global::Thing','local.global::Thing'],
  ['local . global::Thing','local . global::Thing'],
  ['@global::Thing','@global::Thing'],
  ['global::global::Thing','global::global::Thing'],
  ['Pair<"global::Thing  ", global::App.Value>','Pair<"global::Thing  ", App.Value>']
]) {
  assert.equal(canonicalizeTypeText(input,{languageId:'csharp'}).displayText,expected,input);
  assert.equal(canonicalizeTypeText(expected,{languageId:'csharp'}).displayText,expected,'repeated passes retain '+input);
}
assert.equal(normalizeParamTypes({value:'domain::std::Thing'},{languageId:'rust'}).value[0].type,'domain::std::Thing');

for (const [language,detail,returnType,paramType] of [
  ['rust','fn f(value: domain::std::Thing) -> outer::core::Result','outer::core::Result','domain::std::Thing'],
  ['csharp','global::System.Int32 f(世界global::Thing value)','System.Int32','世界global::Thing']
]) {
  const virtualPath=`qualified.${language}`,uri=`poc-vfs:///${virtualPath}`,chunkUid=`qualified-${language}`,byChunkUid={};
  const name=detail.indexOf('f('),target={virtualRange:{start:0,end:detail.length},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'f',kind:'function'}};
  await processDocumentTypes({doc:{virtualPath,text:detail,languageId:language,docHash:'qualified-source'},cmd:'qualified-fixture',
    client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return [{name:'f',kind:12,detail,
      range:{start:{line:0,character:0},end:{line:0,character:detail.length}},
      selectionRange:{start:{line:0,character:name},end:{line:0,character:name+1}}}];}},
    guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,parseSignature:parseGenericSignature,
    uri,languageId:language,openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),byChunkUid,
    signatureParseCache:new Map(),hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,inlayHintsEnabled:false,
    definitionEnabled:false,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
    requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),
    hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),checks:[],checkFlags:{}});
  assert.equal(byChunkUid[chunkUid].payload.returnType,returnType,language);
  assert.equal(byChunkUid[chunkUid].payload.paramTypes.value[0].type,paramType,language);
}
console.log('qualified Rust roots and C# global tokens preserve actual provider type identity');
