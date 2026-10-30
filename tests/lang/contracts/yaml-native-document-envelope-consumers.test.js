import assert from 'node:assert/strict';
import { chunkYaml } from '../../../src/index/chunking/formats/yaml.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { assertYamlEnvelopeBundle } from './yaml-persisted-envelope-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const profiles=[['first: alpha\n','- nativedocumentmarker\n','second: beta\n'],
  ['initialscalar\n','','{last: finalflow}\n'],['{first: initialflow}\n','middlescalar\n','- finalsequence\n']];
const expectedMarkers=[
  [{token:'alpha',documentIndex:0,name:'first'},{token:'nativedocumentmarker',documentIndex:1,name:'document 1'},
    {token:'beta',documentIndex:2,name:'second'}],
  [{token:'initialscalar',documentIndex:0,name:'document 0'},{token:'finalflow',documentIndex:2,name:'document 2'}],
  [{token:'initialflow',documentIndex:0,name:'document 0'},{token:'middlescalar',documentIndex:1,name:'document 1'},
    {token:'finalsequence',documentIndex:2,name:'document 2'}]
];
for(const newline of ['\n','\r\n'])for(const bodies of profiles) {
  const parts=bodies.map((body,index)=>(index===0?'%YAML 1.2\n---\n# leading 😀\n':'---\n# next document\n')+body
    +(index===2?'...\n# trailing\n':''));
  const text=parts.join('').replaceAll('\n',newline),starts=[0];
  for(let index=1;index<parts.length;index++)starts.push(parts.slice(0,index).join('').replaceAll('\n',newline).length);
  for(const enabled of [false,true])for(const useQueries of [false,true]) {
    const treeSitter={enabled,strict:true,adaptive:false,chunkCache:false,configChunking:enabled,useQueries};
    if(enabled){const parser=getNativeTreeSitterParser('yaml',{treeSitter});assert.ok(parser);const tree=parser.parse(text);
      try{assert.equal(tree.rootNode.hasError,false);}finally{tree.delete?.();}}
    const context={treeSitter,yamlChunking:{mode:'top-level'}},chunks=chunkYaml(text,'stream.yaml',context);
    assert.equal(chunks.map(c=>text.slice(c.start,c.end)).join(''),text);
    for(let index=0;index<3;index++) {
      const owners=chunks.filter(c=>c.meta.documentIndex===index);assert.ok(owners.length);
      assert.equal(owners[0].start,starts[index]);assert.equal(owners.at(-1).end,starts[index+1]??text.length);
      for(const chunk of owners) {
        assert.ok(chunk.meta.documentRange.start>=starts[index]&&chunk.meta.documentRange.end<=(starts[index+1]??text.length));
        if(enabled) {
          assert.equal(chunk.meta.nativeParser,'tree-sitter','a native unavailable route cannot qualify as native');
          for(const row of chunk.meta.nativeSections)assert.ok(row.start>=chunk.meta.documentRange.start&&row.end<=chunk.meta.documentRange.end);
        }
      }
    }
    const limited=smartChunk({text,ext:'.yaml',relPath:'stream.yaml',mode:'code',context:{...context,chunking:{maxBytes:36,maxLines:2}}});
    assert.equal(limited.map(c=>text.slice(c.start,c.end)).join(''),text);
    for(const chunk of limited)assert.ok(chunk.start>=starts[chunk.meta.documentIndex]&&chunk.end<=(starts[chunk.meta.documentIndex+1]??text.length));
    const indexed=await assertYamlEnvelopeBundle({text,chunks,documentStarts:starts,markers:expectedMarkers[profiles.indexOf(bodies)]});
    if(bodies[1].includes('nativedocumentmarker')){
      const matches=indexed.chunks.filter(c=>c.tokens.includes('nativedocumentmarker'));
      assert.equal(matches.length,1);assert.equal(matches[0].start,starts[1]);assert.equal(matches[0].name,'document 1');
    }
    const root=chunkYaml(text,'stream.yaml',{...context,yamlChunking:{mode:'root'}});
    assert.equal(root.length,1);assert.equal(root[0].name,'root');assert.equal(root[0].meta.documentIndex,undefined);
  }
}
console.log('Native YAML query/traversal facts remain inside independently expected complete document envelopes and indexed marker owners.');
