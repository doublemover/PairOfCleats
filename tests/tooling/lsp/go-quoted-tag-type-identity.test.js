import assert from 'node:assert/strict';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { canonicalizeTypeText } from '../../../src/shared/type-normalization.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, buildSignatureParseCacheKey,
  isIncompleteTypePayload } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only: Go struct tags are literal type data, including their spaces and
// bracket characters. Exercise actual generic signature and enrichment owners.
const returned='struct { Label string `json:"a  b"` }';
const constraint='[T interface { ~struct { Field string `json:"]  x"` } }]';
for (const spacing of ['', ' ']) {
  const signature='func F'+spacing+constraint+'(value T, other string) '+returned;
  const parsed=parseGenericSignature(signature,'go','F');
  assert.deepEqual(parsed.paramNames,['value','other']);
  assert.deepEqual(parsed.paramTypes,{value:'T',other:'string'});
  assert.equal(parsed.returnType,returned);
  assert.equal(isIncompleteTypePayload(parsed,{symbolKind:12}).incomplete,false);
}
const field='struct { Field string `json:"a  b)"` }';
const signature='func F(value '+field+', other string) '+returned;
const parsed=parseGenericSignature(signature,'go','F');
assert.equal(parsed.paramTypes.value,field);
assert.equal(parsed.returnType,returned);
const distinct=signature.replaceAll('  ',' ');
assert.notEqual(parseGenericSignature(distinct,'go','F').returnType,parsed.returnType);
assert.notEqual(buildSignatureParseCacheKey({languageId:'go',detailText:signature}),
  buildSignatureParseCacheKey({languageId:'go',detailText:distinct}));
assert.equal(parseGenericSignature('func F[T interface { ~struct { F string `tag:"]"` } }(x T) T','go','F'),null,
  'a quoted bracket cannot repair a missing generic-list close');

const virtualPath='tag.go',uri='poc-vfs:///tag.go',chunkUid='tag-chunk',name=signature.indexOf('F('),byChunkUid={};
const target={virtualRange:{start:0,end:signature.length},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'F',kind:'function'}};
await processDocumentTypes({doc:{virtualPath,text:signature,languageId:'go',docHash:'tag-source'},cmd:'go-tag-fixture',
  client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return [{name:'F',kind:12,detail:signature,
    range:{start:{line:0,character:0},end:{line:0,character:signature.length}},
    selectionRange:{start:{line:0,character:name},end:{line:0,character:name+1}}}];}},
  guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,parseSignature:parseGenericSignature,
  uri,languageId:'go',openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),byChunkUid,
  signatureParseCache:new Map(),hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,inlayHintsEnabled:false,
  definitionEnabled:false,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
  requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),
  hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),checks:[],checkFlags:{}});
const payload=byChunkUid[chunkUid].payload;
assert.equal(payload.returnType,canonicalizeTypeText(returned,{languageId:'go'}).displayText);
assert.equal(payload.paramTypes.value[0].type,canonicalizeTypeText(field,{languageId:'go'}).displayText);
assert.ok(payload.returnType.includes('`json:"a  b"`'));
assert.ok(payload.paramTypes.value[0].type.includes('`json:"a  b)"`'));
console.log('Go quoted struct tags and generic brackets retain exact type data in actual provider consumers');
