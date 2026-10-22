import assert from 'node:assert/strict';
import { buildLspLineIndex } from '../../../src/integrations/tooling/lsp/positions.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { flattenSymbols } from '../../../src/integrations/tooling/lsp/symbols.js';
import { createEmptyHoverMetricsResult, processDocumentTypes, extractDefinitionLocations,
  buildSourceSignatureCandidate, buildLspRequestCacheKey, LSP_REQUEST_CACHE_POLICY_VERSION } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Existing document processor and request cache; no server process.
const text='function caller() { return target(); }\rfunction target(x: number): string { return String(x); }';
const virtualPath='admission.ts', uri='poc-vfs:///admission.ts', chunkUid='admission-chunk';
const range=(line,start,end)=>({start:{line,character:start},end:{line,character:end}});
const callerName=range(0,9,15), targetName=range(1,9,15), targetRange=range(1,0,text.length-text.indexOf('\r')-1);
const link={targetUri:uri,targetRange,targetSelectionRange:targetName};
const caller={name:'caller',kind:12,range:range(0,0,text.indexOf('\r')),selectionRange:callerName,detail:'caller'};
const target={virtualRange:{start:9,end:15},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'caller',kind:'function'}};
const parse=(detail)=>detail?.includes('target(x: number): string') ? {
  signature:detail,returnType:'string',paramNames:['x'],paramTypes:{x:[{type:'number'}]}
} : null;
const run=async ({symbols=[caller],payload=link,parser=parse,definitionEnabled=true}={})=>{
  const byChunkUid={},requests=[],parsed=[],cache=new Map(),hoverMetrics=createEmptyHoverMetricsResult();
  const limiter=async fn=>fn();
  await processDocumentTypes({doc:{virtualPath,text,languageId:'typescript',docHash:'admission-source'},cmd:'admission-fixture',
    client:{notify(){},async request(method){requests.push(method);if(method==='textDocument/documentSymbol')return symbols;
      assert.equal(method,'textDocument/definition');return payload;}},
    guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,
    parseSignature:detail=>{parsed.push(detail);return parser(detail);},lineIndexFactory:buildLspLineIndex,
    uri,legacyUri:null,languageId:'typescript',openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),
    byChunkUid,signatureParseCache:new Map(),hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,
    inlayHintsEnabled:false,definitionEnabled,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
    resolvedHoverMaxPerFile:1,hoverLimiter:limiter,definitionLimiter:limiter,signatureHelpLimiter:limiter,
    typeDefinitionLimiter:limiter,referencesLimiter:limiter,requestCacheEntries:cache,requestCachePersistedKeys:new Set(),
    requestCacheMetrics:{hits:0,misses:0,memoryHits:0,persistedHits:0,negativeHits:0,writes:0,byKind:{}},markRequestCacheDirty:()=>{},
    requestCacheContext:{providerId:'fixture',providerVersion:'1',workspaceKey:'admission',generation:{baseBuildId:'admission',semanticRevision:0}},
    hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),hoverLatencyMs:[],hoverMetrics,checks:[],checkFlags:{}});
  return {byChunkUid,requests,parsed,cache,hoverMetrics};
};
for(const payload of [link,{uri,range:targetRange}]) {
  const result=await run({payload});
  assert.equal(result.byChunkUid[chunkUid]?.payload.returnType,'string','exact containing source can supply the existing signature consumer');
  assert.equal(result.hoverMetrics.definitionSucceeded,1);
  assert.ok(result.parsed.some(value=>value.includes('target(x: number): string')));
}
for(const payload of [
  {targetUri:uri,targetRange},
  {...link,targetRange:range(1,10,11)},
  {...link,targetRange:range(1,0,999)},
  {...link,targetSelectionRange:range(99,9,15)},
  {...link,targetUri:'poc-vfs:///foreign.ts',uri,range:targetRange},
  {uri,range:targetName},
  {uri,range:range(1,999,1000)}
]) {
  const result=await run({payload});
  assert.equal(result.byChunkUid[chunkUid],undefined,'malformed, foreign, clamped and name-only ranges cannot borrow a source header');
  assert.equal(result.hoverMetrics.definitionSucceeded,0);
  assert.ok(!result.parsed.some(value=>value.includes('target(x: number): string')));
}
assert.deepEqual(extractDefinitionLocations({targetUri:uri,targetRange}),[]);
assert.equal(flattenSymbols([{...caller,selectionRange:undefined}])[0].selectionRange,null);
const complete=detail=>({signature:detail,returnType:'number',paramNames:[]});
for(const symbols of [
  [{...caller,selectionRange:undefined}],
  [{...caller,range:range(0,10,11)}],
  [{...caller,range:range(0,0,999)}],
  [{name:'caller',kind:12,detail:'poison(): number',location:{uri:'poc-vfs:///foreign.ts',range:callerName}}],
  [{name:'caller',kind:12,detail:'poison(): number',location:{range:callerName}}]
]) {
  const result=await run({symbols,parser:complete,definitionEnabled:false});
  assert.equal(Object.keys(result.byChunkUid).length,0,'symbol selection/container/URI must belong to this document before parsing');
  assert.deepEqual(result.parsed,[]);
}
const flat=await run({symbols:[{name:'caller',kind:12,detail:'caller(): number',location:{uri,range:callerName}}],parser:complete,definitionEnabled:false});
assert.equal(flat.byChunkUid[chunkUid]?.payload.returnType,'number','same-URI flat SymbolInformation retains its single range');
assert.equal(buildSourceSignatureCandidate('f()', {start:0,end:2}),null,'exclusive range ends cannot borrow the next closing parenthesis');
assert.equal(buildSourceSignatureCandidate('f()', {start:0,end:3}),'f()');
assert.equal(buildSourceSignatureCandidate('f()', {start:0,end:99}),null);
const keyInput={providerId:'fixture',virtualPath,uri,generation:{baseBuildId:'admission',semanticRevision:0},docHash:'source',requestKind:'definition',position:callerName.start};
assert.ok(buildLspRequestCacheKey(keyInput).startsWith(LSP_REQUEST_CACHE_POLICY_VERSION+'|'));
assert.notEqual(buildLspRequestCacheKey(keyInput),buildLspRequestCacheKey({...keyInput,policyVersion:'rq3'}));
console.log('legacy source signatures preserve protocol shapes, exact enclosures, URI ownership and cache identity');
