import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
applyTestEnv();
let extensionName;
for (const methods of [['def first: A = value(0)','def second: A = value(1)'],['def second: A = value(1)','def first: A = value(0)']]) {
  const text = 'package object demo { val packageMarker = 7; def work(): Int = packageMarker }\n'
    + 'extension [A](value: List[A]) {\n '+methods.join('\n ')+'\n}\n'
    + 'extension (value: String)\n def twice: String = value + value\n def wrap(prefix: String): String = prefix + value\n'
    + 'given intOrdering: Ordering[Int] = Ordering.Int\n'
    + 'given globalOrdering: Ordering[Int] with\n def compare(x: Int, y: Int): Int = x - y\n'
    + 'object Main { def control(): Int = 0 }\n';
  const fixture=await prepareRegisteredLanguage({text,ext:'.scala'});
  const extensions=fixture.chunks.filter(chunk=>chunk.kind==='ExtensionDeclaration');
  assert.equal(extensions.length,2);
  const generic=extensions.find(chunk=>chunk.name.includes('[A]'));
  assert.ok(generic.name.startsWith('extension[A]'));
  if(extensionName) assert.equal(generic.name,extensionName,'method ordering does not provide group identity');
  extensionName=generic.name;
  assert.ok(fixture.chunks.some(chunk=>chunk.name===generic.name+'.first' && chunk.kind==='MethodDeclaration'));
  assert.ok(fixture.chunks.some(chunk=>chunk.name==='demo' && text.slice(chunk.start,chunk.end).includes('packageMarker')));
  assert.ok(fixture.chunks.some(chunk=>chunk.name==='demo.work'));
  assert.ok(fixture.chunks.some(chunk=>chunk.name==='intOrdering' && chunk.kind==='GivenDeclaration'));
  assert.ok(fixture.chunks.some(chunk=>chunk.name==='globalOrdering.compare'));
  assert.ok(!fixture.chunks.some(chunk=>chunk.name==='A' || chunk.name==='first' && chunk.kind==='ExtensionDeclaration'));
}
for(const [ext,text,name,doc] of [
  ['.groovy','class Alpha {\n /** Useful method docs */\n int ping(int value) { return value; }\n}\n','Alpha.ping','Useful method docs'],
  ['.r','# Useful R docs\nalpha <- function(value) { value }\n','alpha','Useful R docs']
]) {
  const fixture=await prepareRegisteredLanguage({text,ext});
  const payload=fixture.payloads.find(row=>row.name===name);
  assert.ok(payload);assert.match(payload.docmeta.doc,new RegExp(doc));
  assert.ok(payload.docmeta.signature.includes('value'));assert.ok(payload.fieldTokens.signature.includes('value'));
  assert.equal(JSON.parse(JSON.stringify(payload)).docmeta.doc,payload.docmeta.doc);
  const empty=fixture.lang.extractDocMeta({...fixture.input,chunk:{name:'empty',meta:{}},context:fixture.context});
  assert.equal(empty.signature,null);assert.equal(empty.doc,'');
}
const rSource = ['alpha <-',' function(x) { x }','beta =',' function(y) { y }','.alpha <<- function(x) { x }',
  '`alpha beta` <- function(x) { x }','`名字` <- function(x) { x }','wrapped <- (function(z) { z })',
  'lambda <-',' \\(value) value','outer <- function(x) { inner <- function(y) y; inner(x) }','lapply(values, function(item) item)',''].join('\n');
const r=await prepareRegisteredLanguage({text:rSource,ext:'.r'});
for(const name of ['alpha','beta','.alpha','alpha beta','名字','wrapped','lambda','outer','outer.inner']) assert.ok(r.chunks.some(chunk=>chunk.name===name),name);
assert.ok(r.chunks.some(chunk=>/^anonymous@\d+$/u.test(chunk.name)));
assert.ok(!r.chunks.some(chunk=>['function','\\','x','y','item'].includes(chunk.name)));
assert.equal(new Set(r.chunks.map(chunk=>chunk.chunkUid)).size,r.chunks.length);
console.log('Scala containers, R assignment identities and shared native documentation/signature consumers passed.');
