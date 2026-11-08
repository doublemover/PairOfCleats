import assert from 'node:assert/strict';
import { flattenSymbols } from '../../../src/integrations/tooling/lsp/symbols.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';
import { createEmptyHoverMetricsResult, processDocumentTypes } from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

// Authored only. Actual symbol normalization and ordinary document enrichment;
// no recursive fixture builder, native parser or language-server process.
const range={start:{line:0,character:0},end:{line:0,character:1}};
const node=(name,children=[])=>({name,kind:12,detail:'f(): number',range,selectionRange:range,children});
const tree=[node('outer',[node('left',[node('leaf')]),node('right')]),node('sibling')];
const flat=flattenSymbols(tree);
assert.deepEqual(flat.map(symbol=>symbol.fullName),['outer','outer.left','outer.left.leaf','outer.right','sibling']);
assert.ok(flat.every(symbol=>symbol.protocolShape==='DocumentSymbol'));
assert.equal(flat[2].range,range,'range ownership is preserved without cloning or replacing its selection');
assert.equal(flattenSymbols([{name:'missing',kind:12,range}])[0].selectionRange,null);
const deep=node('f');let cursor=deep;
for (let index=0;index<4096;index++) { const child=node('f');cursor.children=[child];cursor=child; }
const deepRows=flattenSymbols([deep]);
assert.equal(deepRows.length,4097);
assert.equal(deepRows.at(-1).fullName.length,8193);
assert.ok(deepRows.at(-1).fullName.endsWith('.f'));
const shared=[node('child')];
assert.deepEqual(flattenSymbols([node('first',shared),node('second',shared)]).map(symbol=>symbol.fullName),
  ['first','first.child','second','second.child'],'sibling occurrences may share an input array without global deduplication');
const cyclic=node('cycle');cyclic.children=[cyclic];
assert.throws(()=>flattenSymbols([cyclic]),/Cyclic LSP/,'malformed cyclic callback data must fail rather than loop or claim a complete prefix');

const root=node('f');cursor=root;
for (let index=0;index<64;index++) { const child=node('f');cursor.children=[child];cursor=child; }
const virtualPath='nested.js',uri='poc-vfs:///nested.js',chunkUid='nested-chunk',byChunkUid={},parsed=[];
const target={virtualRange:{start:0,end:1},chunkRef:{chunkUid,file:virtualPath},symbolHint:{name:'f',kind:'function'}};
const parser=detail=>{parsed.push(detail);return {signature:detail,returnType:'number',paramNames:[]};};
parser.isSymbolSensitive=false;
const result=await processDocumentTypes({doc:{virtualPath,text:'f',languageId:'javascript',docHash:'nested-source'},cmd:'nested-fixture',
  client:{notify(){},async request(method){assert.equal(method,'textDocument/documentSymbol');return [root];}},
  guard:{isOpen:()=>false,run:async fn=>fn({timeoutMs:1000})},log:()=>{},strict:true,parseSignature:parser,
  uri,languageId:'javascript',openDocs:new Map(),targetIndexesByPath:new Map([[virtualPath,buildTargetLookupIndex([target])]]),
  byChunkUid,signatureParseCache:new Map(),hoverEnabled:false,semanticTokensEnabled:false,signatureHelpEnabled:false,inlayHintsEnabled:false,
  definitionEnabled:false,typeDefinitionEnabled:false,referencesEnabled:false,hoverRequireMissingReturn:true,
  requestCacheEntries:new Map(),requestCachePersistedKeys:new Set(),hoverControl:{disabledGlobal:false},hoverFileStats:new Map(),
  hoverLatencyMs:[],hoverMetrics:createEmptyHoverMetricsResult(),checks:[],checkFlags:{}});
assert.equal(result.enrichedDelta,1);
assert.equal(byChunkUid[chunkUid].payload.returnType,'number');
assert.deepEqual(parsed,['f(): number'],'immutable repeated symbol details reuse the existing parser owner');
console.log('iterative symbol preorder preserves deep rows, source ownership and actual enrichment');
