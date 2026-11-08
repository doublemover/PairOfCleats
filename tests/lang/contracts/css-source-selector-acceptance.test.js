import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { getNativeTreeSitterParser } from '../../../src/lang/tree-sitter/native-runtime.js';
import { smartChunk } from '../../../src/index/chunking/dispatch.js';
import { readChunkContent } from '../../../src/shared/embedded-content.js';
applyTestEnv();
for(const newline of ['\n','\r\n']) {
  const selectors=['[data-x="a  b"]','[data-x="a b"]','[data-x="a\tb"]','[data-x="café"]','[data-x="{"]','[data-x=";"]',
    '[data-x="escaped\\\"quote"]','.one,'+newline+'.two',':is(.alpha, .beta)'];
  const text=selectors.map(selector=>selector+' { color: red; }').join(newline)+newline
    +'@scope (.panel) to (.nested) { @scope (.inner) { .title { color: blue; } } }'+newline
    +'@scope (.empty) {}'+newline+'@media screen { .media {color:red} }'+newline+'@supports (display: grid) { .grid {display:grid} }';
  const tree=getNativeTreeSitterParser('css').parse(text);
  try {assert.equal(tree.rootNode.hasError,false);} finally {tree.delete?.();}
  const fixture=await prepareRegisteredLanguage({text,ext:'.css'});
  for(const selector of selectors) {
    const chunks=fixture.chunks.filter(chunk=>chunk.name===selector);
    assert.equal(chunks.length,1,selector);assert.equal(readChunkContent(text,chunks[0]),selector+' { color: red; }');
    assert.equal(fixture.payloads.find(payload=>payload.start===chunks[0].start).name,selector);
  }
  for(const name of ['@scope (.panel) to (.nested)','@scope (.inner)','@scope (.empty)']) assert.ok(fixture.chunks.some(chunk=>chunk.name===name));
  const a=fixture.chunks.find(chunk=>chunk.name==='[data-x="a  b"]');
  const b=fixture.chunks.find(chunk=>chunk.name==='[data-x="a b"]');assert.notEqual(a.name,b.name);assert.notEqual(a.chunkUid,b.chunkUid);
  const split=smartChunk({text,ext:'.css',mode:'code',context:{...fixture.context,treeSitter:fixture.input.options.treeSitter,
    chunking:{maxBytes:35}}});
  for(const owner of fixture.chunks) {
    const pieces=split.filter(chunk=>chunk.name===owner.name && chunk.start>=owner.start && chunk.end<=owner.end);
    assert.equal(pieces.map(chunk=>readChunkContent(text,chunk)).join(''),readChunkContent(text,owner));
  }
}
console.log('CSS scope source and exact selector whitespace/quoted punctuation identities survive native registry and limits.');
