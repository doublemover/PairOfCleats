import assert from 'node:assert/strict';
import { prepareRegisteredLanguage } from '../../helpers/registered-language-acceptance.js';
import { applyTestEnv } from '../../helpers/test-env.js';
applyTestEnv();
for(const ext of ['.c','.cpp']) {
  const text='#include <stddef.h>\n// Useful declaration docs\nint callee(){return 1;}\n'
    +'int first(int value), second(int value);\nint *pointer(int value);\nint (*callback)(int);\nint ordinary_field;\n'
    +(ext==='.cpp'?'class A { public: A(); ~A(); int method(int value); virtual int iface() = 0; int method(double value); int field; };\n':'')
    +'int caller(){return callee();}\n';
  const fixture=await prepareRegisteredLanguage({text,ext});
  for(const name of ['first','second','pointer']) {
    const chunks=fixture.chunks.filter(chunk=>chunk.name===name && chunk.kind==='FunctionDeclaration');
    assert.equal(chunks.length,1,name);assert.equal(chunks[0].meta.bodyless,true);
    assert.ok(text.slice(chunks[0].start,chunks[0].end).endsWith(';'));
  }
  assert.deepEqual(fixture.relations.calls,[['caller','callee']]);
  assert.ok(!fixture.chunks.some(chunk=>['callback','ordinary_field','A.field'].includes(chunk.name)));
  const payload=fixture.payloads.find(row=>row.name==='callee');
  assert.match(payload.docmeta.doc,/Useful declaration docs/);assert.equal(payload.docmeta.signature,'int callee()');
  assert.ok(fixture.relations.exports.includes('caller'));assert.ok(fixture.relations.usages.includes('callee'));
  if(ext==='.cpp') for(const [name,count] of [['A.A',1],['A.~A',1],['A.method',2],['A.iface',1]]) {
    const chunks=fixture.chunks.filter(chunk=>chunk.name===name);assert.equal(chunks.length,count,name);
    assert.ok(chunks.every(chunk=>chunk.meta.bodyless===true));
  }
}
for(const ext of ['.c','.cpp','.m']) {
  const text='// Useful fallback docs\nint callee(){return 1;}\nint caller(){return callee();}\n';
  const fallback=await prepareRegisteredLanguage({text,ext,options:{treeSitter:{enabled:false},astDataflowEnabled:false,controlFlowEnabled:false}});
  assert.ok(fallback.relations.calls.some(edge=>edge[0]==='caller'&&edge[1]==='callee'));
  assert.match(fallback.payloads.find(row=>row.name==='callee').docmeta.doc,/Useful fallback docs/);
}
console.log('C-family prototypes and registered declaration/metadata/call handoffs retain complete owners and exclude fields.');
