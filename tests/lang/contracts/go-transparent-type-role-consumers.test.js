import assert from 'node:assert/strict';
import { checkNativeDeclarations } from '../../helpers/native-declaration-acceptance.js';
import { buildGoChunks } from '../../../src/lang/go.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { resolveGoDeclaredType } from '../../../src/lang/tree-sitter/go-type-role.js';
import { TREE_SITTER_CHUNK_VERSION } from '../../../src/lang/tree-sitter/config.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
for(const declarations of [
  ['S (struct { X int })','I ((interface { Run() }))'],
  ['I ((interface { Run() }))','S (struct { X int })']
]) {
  const text='package p\n// Group documentation\ntype (\n '+declarations.join('\n ')+'\n Alias = S\n)\n'
    +'// Standalone documentation\ntype Single ( /* transparent */ struct { X int })\n'
    +'type Rows ([]struct { X int })\ntype Reader (interface { Read() struct { X int } })\n'
    +'type Factory (func() interface { Run() })\ntype Map (map[string]struct { X int })\n'
    +'type Pointer (*struct { X int })\ntype Channel (chan struct { X int })\n';
  const expected=[['S','StructDeclaration'],['I','InterfaceDeclaration'],['Alias','TypeAlias'],
    ['Single','StructDeclaration'],['Reader','InterfaceDeclaration'],...['Rows','Factory','Map','Pointer','Channel'].map(name=>[name,'TypeDeclaration'])]
    .map(([name,kind])=>({name,kind,count:1}));
  const result=await checkNativeDeclarations({languageId:'go',ext:'.go',text,build:buildGoChunks,preparedKey:'goChunks',expected});
  assert.equal(result.built.length,expected.length,'one actual canonical declaration per type spec');
  assert.equal(text.slice(result.built.find(c=>c.name==='Single').start,result.built.find(c=>c.name==='Single').end),
    'type Single ( /* transparent */ struct { X int })');
  const parser=getNativeTreeSitterParser('go'),tree=parser.parse(text);
  try {
    const stack=[tree.rootNode];
    while(stack.length) {
      const node=stack.pop();
      if(node.type==='type_spec') {
        let visits=0;const type=resolveGoDeclaredType(node,()=>visits++),name=node.childForFieldName('name').text;
        assert.equal(visits,name==='I'?2:1,'only transparent wrappers are visited once');
        assert.ok(type&&!type.type.startsWith('parenthesized'));
      }
      for(const child of node.namedChildren)stack.push(child);
    }
  } finally {tree.delete?.();}
}
assert.equal(TREE_SITTER_CHUNK_VERSION,'17');
console.log('Actual Go query/traversal roles unwrap only transparent types and preserve grouped/alias/source/UID ownership.');
