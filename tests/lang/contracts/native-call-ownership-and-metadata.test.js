import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
const options = {treeSitter:{enabled:true,strict:true,chunkCache:false,adaptive:false},astDataflowEnabled:false,controlFlowEnabled:false};
const prepare = async (ext,text) => {
  const input={ext,text,relPath:`fixture${ext}`,mode:'code',options};
  const {lang,context}=await buildLanguageContext(input);
  return {lang,context,relations:lang.buildRelations({...input,context}),input};
};
const lua=await prepare('.lua','M.make = function(value) return value end\nfunction idle(value) return value end\nfunction caller() return M.make(1) end\nfunction recur(n) return recur(n-1) end\n');
assert.equal(lua.context.luaChunks.filter(chunk=>chunk.name === 'M.make').length,1);
assert.deepEqual(lua.relations.calls.slice().sort(),[['caller','M.make'],['recur','recur']].sort());
assert.ok(lua.relations.callDetails.every(detail=>detail.start>=0 && detail.end>detail.start && detail.coordinateSystem === 'utf16'));
const ruby=await prepare('.rb','class A\n def same(value)\n first()\n end\n def self.same(value)\n second()\n end\nend\ndef idle()\n42\nend\ndef recur()\nrecur()\nend\n');
assert.deepEqual(ruby.relations.calls.slice().sort(),[['A.same','first'],['A.self.same','second'],['recur','recur']].sort());
for(const name of ['A.same','A.self.same']) {
  const chunk=ruby.context.rubyChunks.find(chunk=>chunk.name === name);
  assert.deepEqual(ruby.lang.extractDocMeta({...ruby.input,chunk,context:ruby.context}).params,['value']);
}
const php=await prepare('.php','<?php\nenum Status:string {case Ready="ready"; public function label(int $x): int {return alpha($x);} }\ninterface Service {public function run(): int;}\nclass C {private function hidden(string $secret): string {return $secret;}}\n');
assert.ok(php.context.phpChunks.some(chunk=>chunk.name === 'Status' && chunk.kind === 'EnumDeclaration'));
assert.deepEqual(php.relations.calls,[['Status.label','alpha']]);
assert.ok(php.relations.exports.includes('Status.label'));assert.ok(!php.relations.exports.includes('C.hidden'));
const label=php.context.phpChunks.find(chunk=>chunk.name === 'Status.label');
const metadata=php.lang.extractDocMeta({...php.input,chunk:label,context:php.context});
assert.deepEqual(metadata.params,['x']);assert.equal(metadata.returnType,'int');assert.equal(metadata.visibility,'public');
const shell=await prepare('.sh',"caller() { MODE=fast callee; }\nreader() {\n cat <<'END'\n phantom\nEND\n callee\n}\n");
assert.deepEqual(shell.relations.calls.slice().sort(),[['caller','callee'],['reader','cat'],['reader','callee']].sort());
const scala=await prepare('.scala',Array.from({length:110},(_,i)=>`def f${i}(): Int = g${i}()`).join('\n')+'\n');
assert.equal(scala.relations.calls.length,110,'correct supported syntax cannot inherit the unrelated 96-pair cutoff');
assert.equal(scala.relations.callDetails.length,110);
for(let index=0;index<110;index++) assert.ok(scala.relations.calls.some(([caller,callee])=>caller===`f${index}`&&callee===`g${index}`));
const noCalls=await prepare('.scala','def first(): Int = 1\ndef second(): Int = 2\n');
assert.deepEqual(noCalls.relations.calls,[]);
console.log('native call ownership and structured metadata passed');