import assert from 'node:assert/strict';
import { readSignatureLines } from '../../../src/lang/shared/signature-lines.js';
import { findCLikeBodyBounds } from '../../../src/lang/clike.js';
import { extractSignature } from '../../../src/lang/tree-sitter/chunking.js';
for (const signature of ['function f({a,b}, x=1)', 'function f(x = "a;b")',
  'function f(\n arg: { value: string }\n)', 'void f(/* ; { */\n int value\n)',
  'function f(): { value: string }']) {
  const text = `${signature} { consume(value); }`;
  const scanned = readSignatureLines(text.split('\n'),0);
  assert.equal(scanned.hasBody,true);
  const bounds = findCLikeBodyBounds(text,0);
  assert.equal(text.slice(bounds.bodyStart,bounds.bodyEnd), '{ consume(value); }');
  assert.equal(extractSignature(text,0,text.length), signature.replace(/\s+/g,' '));
}
const noBody = readSignatureLines(['void f(/* { */ int x);'],0);
assert.equal(noBody.hasBody,false);
assert.ok(noBody.signature.includes('int x'));
const nativeText = 'function f({a,b}) { consume(a); }';
const bodyStart = nativeText.lastIndexOf('{');
assert.equal(extractSignature(nativeText,0,nativeText.length,{ childForFieldName: () => ({ startIndex: bodyStart }) }), 'function f({a,b})');
console.log('shared fallback and native signature boundaries passed');
