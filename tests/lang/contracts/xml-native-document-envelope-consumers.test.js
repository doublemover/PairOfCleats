import assert from 'node:assert/strict';
import { chunkXml } from '../../../src/index/chunking/formats/xml.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { createProcessChunksFixtureContext,processFixtureChunks } from '../../indexing/file-processor/process-chunks-fixture.js';
import { SEMANTIC_ANALYSIS_VERSIONS,semanticAnalysisPolicyIdentity } from '../../../src/index/semantic/analysis-versions.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const coverage=(text,chunks)=>{
  const covered=new Uint8Array(text.length);
  for(const chunk of chunks) {
    assert.ok(chunk.start>=0&&chunk.end<=text.length&&chunk.end>chunk.start);
    covered.fill(1,chunk.start,chunk.end);
    const range=chunk.meta.structuralRange;
    if(range) assert.deepEqual(range,{start:chunk.start,end:chunk.end},'native structural ownership is never widened');
  }
  assert.ok(covered.every(Boolean),'union of overlapping structural chunks retains every original source unit');
};
const sources=['<root/>','<root marker="rootmarker">before</root>',
  '<?xml version="1.0"?>\n<!-- prologsentinel -->\n<!DOCTYPE root []>\n<?owned inert?>\n'
    +'<root xmlns="urn:inert" marker="rootmarker">😀before<a>alpha</a>between<![CDATA[opaque <x>]]><b>beta</b>after</root><!-- trailing -->'];
for(const native of [false,true]) for(const useQueries of [false,true]) {
  for(const text of sources) {
    const treeSitter={enabled:native,strict:true,adaptive:false,chunkCache:false,configChunking:native,useQueries};
    if(native) {
      const parser=getNativeTreeSitterParser('xml',{treeSitter}); assert.ok(parser,'actual optional XML grammar required');
      const tree=parser.parse(text); try {assert.equal(tree.rootNode.hasError,false);} finally {tree.delete?.();}
    }
    const chunks=chunkXml(text,{treeSitter}); coverage(text,chunks);
    if(native) assert.ok(chunks.some(chunk=>chunk.meta.structuralRangeSource==='native-node'),'native success cannot be lexical fallback');
    const limited=smartChunk({text,ext:'.xml',mode:'code',context:{treeSitter,chunking:{maxBytes:45,maxLines:2}}});
    // A split retains its original parent range in metadata, so check union separately.
    coverage(text,limited.map(chunk=>({...chunk,meta:{...chunk.meta,structuralRange:undefined}})));
    if(text.includes('prologsentinel')) {
      const gaps=chunks.filter(chunk=>chunk.meta.sourceCoverage==='document-envelope');
      assert.equal(gaps.filter(chunk=>text.slice(chunk.start,chunk.end).includes('prologsentinel')).length,1);
      const {context}=createProcessChunksFixtureContext({text,ext:'.xml',languageId:'xml',rel:'fixture.xml',
        riskAnalysisEnabled:false,typeInferenceEnabled:false,overrides:{sc:chunks}});
      const indexed=await processFixtureChunks(context);
      assert.ok(indexed.chunks.some(chunk=>chunk.tokens.includes('prologsentinel')),'actual token-flow/persisted payload searches the document prefix');
      assert.ok(indexed.chunks.some(chunk=>chunk.tokens.includes('rootmarker')));
    }
  }
}
assert.equal(SEMANTIC_ANALYSIS_VERSIONS.sourceChunking,'54');
for(const old of ['50','51','52','53'])assert.notEqual(semanticAnalysisPolicyIdentity({enrichment:{},storage:{}}),
  semanticAnalysisPolicyIdentity({enrichment:{},storage:{}},{...SEMANTIC_ANALYSIS_VERSIONS,sourceChunking:old}));
console.log('XML native query/traversal and lexical document envelopes preserve inert prolog, mixed content and actual searchable payloads.');
