import assert from 'node:assert/strict';
import { buildLspLineIndex, exactRangeToOffsets } from '../../../src/integrations/tooling/lsp/positions.js';
import { exactLspRange } from '../../../src/index/semantic/lsp-locations.js';
import { shapeDiagnosticsByChunkUid } from '../../../src/integrations/tooling/providers/lsp/diagnostics.js';
import { buildTargetLookupIndex, findTargetForOffsets } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Expected protocol units are explicit, independent of the
// outgoing position helper and its matching roundtrip implementation.
const text='/*😀*/ function alpha() { return 1; }', lineIndex=buildLspLineIndex(text);
const range=(start,end)=>({start:{line:0,character:start},end:{line:0,character:end}});
const invalid=range(3,4), uri='poc-vfs:///scalar.js', virtualPath='scalar.js', chunkUid='scalar-chunk';
for(const encoding of ['utf-8','utf-16','utf-32']) {
  const [start,end]=encoding==='utf-8' ? [2,6] : encoding==='utf-32' ? [2,3] : [2,4];
  assert.deepEqual(exactRangeToOffsets(lineIndex,range(start,end),{text,positionEncoding:encoding}),{start:2,end:4});
  assert.deepEqual(exactLspRange({},text,range(start,end),encoding),[2,4]);
}
for(const bad of [range(3,4),range(2,3),range(3,3)]) {
  assert.equal(exactRangeToOffsets(lineIndex,bad,{text}),null,'a split scalar cannot own an exact source endpoint');
  assert.equal(exactLspRange({},text,bad),null,'canonical and legacy consumers share the scalar admission owner');
}
for(const partialByte of [3,4,5]) {
  assert.equal(exactRangeToOffsets(lineIndex,range(partialByte,6),{text,positionEncoding:'utf-8'}),null);
}
const target={virtualRange:{start:0,end:text.length},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'alpha',kind:'function'}};
const targetIndexesByPath=new Map([[virtualPath,buildTargetLookupIndex([target])]]);
const name=text.indexOf('alpha'), valid=range(name,name+5);
const goodDiagnostic={range:valid,message:'actual name'}, badDiagnostic={range:invalid,message:'split scalar'};
const checks=[];
const diagnostics=shapeDiagnosticsByChunkUid({captureDiagnostics:true,diagnosticsByUri:new Map([[uri,[badDiagnostic,goodDiagnostic]]]),
  docs:[{virtualPath,text}],openDocs:new Map([[virtualPath,{uri,text}]]),targetIndexesByPath,
  diskPathMap:new Map(),resolvedRoot:process.cwd(),resolvedScheme:'poc-vfs',lineIndexFactory:buildLspLineIndex,
  maxDiagnosticsPerChunk:1,checks,checkFlags:{},findTargetForOffsets});
assert.equal(diagnostics.diagnosticsCount,1);
assert.deepEqual(diagnostics.diagnosticsByChunkUid[chunkUid],[goodDiagnostic],'invalid scalar diagnostics do not consume the valid chunk cap');
assert.deepEqual(checks,[]);

const parsed=[], byChunkUid={}, limiter=async fn=>fn(), guard={isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})};
const symbols=[{name:'alpha',kind:12,detail:'poison(): string',range:invalid,selectionRange:invalid},
  {name:'alpha',kind:12,detail:'alpha(): number',range:valid,selectionRange:valid}];
const result=await processDocumentTypes({doc:{virtualPath,text,languageId:'javascript',docHash:'scalar-source'},cmd:'scalar-fixture',
  client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return symbols;}},guard,
  log:()=>{},strict:true,parseSignature:detail=>{parsed.push(detail);return {signature:detail,paramNames:[],returnType:detail.includes('poison')?'string':'number'};},
  uri,languageId:'javascript',openDocs:new Map(),targetIndexesByPath,byChunkUid,signatureParseCache:new Map(),
  hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,inlayHintsEnabled:false,
  definitionEnabled:false,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
  resolvedHoverMaxPerFile:1,hoverLimiter:limiter,signatureHelpLimiter:limiter,definitionLimiter:limiter,
  typeDefinitionLimiter:limiter,referencesLimiter:limiter,requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),
  requestCacheMetrics:{hits:0,misses:0,memoryHits:0,persistedHits:0,negativeHits:0,writes:0,byKind:{}},markRequestCacheDirty:()=>{},
  hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),
  checks:[],checkFlags:{}});
assert.equal(result.enrichedDelta,1);
assert.equal(byChunkUid[chunkUid].payload.returnType,'number');
assert.ok(!parsed.some(value=>value.includes('poison')),'a split-scalar symbol cannot enter signature parsing or chunk enrichment');
console.log('shared exact scalar coordinates preserve diagnostic caps and actual symbol enrichment');
