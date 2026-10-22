import assert from 'node:assert/strict';
import { buildLanguageContext } from '../../../src/index/language-registry.js';
const text = '#include <stddef.h>\n// useful docs\nint callee(){return 1;}\nint caller(){return callee();}\n';
for (const ext of ['.c','.cpp','.m']) for (const enabled of [false,true]) {
  const input = {text,ext,relPath:`demo${ext}`,mode:'code',options:{treeSitter:{enabled,strict:enabled,chunkCache:false}}};
  const {lang,context} = await buildLanguageContext(input);
  assert.ok(context.clikeChunks.length);
  const relations = lang.buildRelations({...input,context});
  assert.ok(relations.imports.includes('stddef.h'));
  assert.ok(relations.exports.includes('callee')); assert.ok(relations.exports.includes('caller'));
  assert.ok(relations.calls.some(([caller,callee]) => caller === 'caller' && callee === 'callee'));
  const chunk = context.clikeChunks.find(row => row.name === 'callee');
  const metadata = lang.extractDocMeta({...input,chunk,context,fileRelations:null});
  assert.match(metadata.doc,/useful docs/); assert.match(metadata.signature,/callee/);
}
console.log('registered C-family consumers reuse prepared declarations and doc metadata');