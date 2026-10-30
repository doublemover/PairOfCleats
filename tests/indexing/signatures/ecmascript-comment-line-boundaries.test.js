import assert from 'node:assert/strict';
import { findDeclarationBoundary } from '../../../src/lang/shared/declaration-boundary.js';
import { findBraceDelimitedBodyBounds } from '../../../src/lang/brace-bounds.js';
import { findTypeScriptBodyBounds } from '../../../src/lang/typescript/brace-bounds.js';
import { readSignatureLines } from '../../../src/lang/typescript/signature.js';
import { buildTypeScriptChunksHeuristic } from '../../../src/lang/typescript/chunks-heuristic.js';
import { buildTypeScriptChunksFromAst } from '../../../src/lang/typescript/chunks-ast.js';
import { buildTypeScriptRelations } from '../../../src/lang/typescript/relations.js';
import { extractSignature } from '../../../src/lang/tree-sitter/chunking.js';
import { LANG_CONFIG, TREE_SITTER_CHUNK_VERSION } from '../../../src/lang/tree-sitter/config.js';

// Authored only: actual TypeScript chunk and relation consumers, shared fallback
// boundary owners, and the native adapter's actual grammar policy. No native run.
for (const ending of ['\r','\n','\r\n','\u2028','\u2029']) {
  const header='function outer() // header { ignored';
  const body='{ // ignored closing brace }'+ending+' realCall(); return 1; }';
  const text=header+ending+body, bodyStart=header.length+ending.length;
  const expected={bodyStart,bodyEnd:text.length};
  assert.deepEqual(findTypeScriptBodyBounds(text,0),expected,'header and body comments use the same ECMAScript terminators');
  assert.deepEqual(findBraceDelimitedBodyBounds(text,0,{charLiterals:true,ecmaScriptLineTerminators:true}),expected);
  assert.equal(readSignatureLines(text.split('\n'),0).bodyOffset,bodyStart);
  for (const language of ['javascript','jsx','typescript','tsx']) {
    const options=LANG_CONFIG[language].signatureBoundaryOptions;
    assert.equal(options.ecmaScriptLineTerminators,true);
    assert.equal(extractSignature(text,0,text.length,null,options),header);
  }
  const chunks=buildTypeScriptChunksHeuristic(text);
  assert.equal(chunks.length,1);
  assert.equal(chunks[0].name,'outer');
  assert.equal(text.slice(chunks[0].start,chunks[0].end),text,'fallback chunk retains the complete body after a non-LF line comment');
  // An unsupported trailing token forces the existing parser-unavailable
  // relation fallback without replacing its real parser or supplying an AST.
  const relations=buildTypeScriptRelations(text+'\n@@@',chunks,{parser:'typescript'});
  assert.ok(relations.calls.some(([caller,callee])=>caller==='outer' && callee==='realCall'));
  assert.ok(!relations.calls.some(([caller,callee])=>caller==='outer' && callee==='outer'),'declaration header cannot become false recursion when locating the body');

  const classSource='class Box // type header'+ending+'{ run(){ return 1; } }';
  const astChunks=buildTypeScriptChunksFromAst(classSource,{ext:'.ts'});
  const box=astChunks.find(chunk=>chunk.name==='Box');
  assert.equal(box.meta.signature,'class Box // type header','actual compiler AST class metadata keeps the lexical header separate from its body');
  assert.equal(classSource.slice(box.start,box.end),classSource);
}
const policy={ecmaScriptLineTerminators:true,maxLines:2};
for (const ending of ['\r','\n','\r\n','\u2028','\u2029']) {
  const oneBreak='function f('+ending+'arg) { return arg; }';
  assert.equal(findDeclarationBoundary(oneBreak,0,policy).bodyStart,oneBreak.indexOf('{'),'CRLF is one line break, not two');
  const twoBreaks='function f('+ending+'arg,'+ending+'other) { return other; }';
  const bounded=findDeclarationBoundary(twoBreaks,0,policy);
  assert.equal(bounded.bodyStart,-1);assert.equal(bounded.capped,true);
}
for (const ending of ['\r','\u2028','\u2029']) {
  const text='function f() // ignored'+ending+'{ return 1; }';
  assert.equal(findDeclarationBoundary(text).bodyStart,-1,'default language policy is not silently changed to ECMAScript');
  assert.equal(findDeclarationBoundary(text,0,{ecmaScriptLineTerminators:true}).bodyStart,text.indexOf('{'));
}
assert.ok(Number.isSafeInteger(Number(TREE_SITTER_CHUNK_VERSION)) && Number(TREE_SITTER_CHUNK_VERSION) >= 7,
  'the ECMAScript boundary repair requires producer 7 or a later semantic revision');
console.log('explicit ECMAScript comment terminators preserve native previews and actual TypeScript chunks/relations');
