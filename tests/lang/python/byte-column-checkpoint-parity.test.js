import assert from 'node:assert/strict';
import { createPythonByteColumnResolver } from '../../../src/lang/python/byte-columns.js';
import { buildPythonChunksFromAst } from '../../../src/lang/python/chunks-from-ast.js';
import { buildLineIndex } from '../../../src/lang/python/normalize.js';

// Authored geometry control only: supplied CPython-style columns do not claim
// parser/native qualification. Prefix encoding is independent of checkpoint descent.
for (const text of ['a'.repeat(255) + '😀' + '漢'.repeat(100) + 'x', 'λ😀漢a'.repeat(2048), 'ascii only']) {
  const resolver = createPythonByteColumnResolver(text, buildLineIndex(text));
  const boundaries = [0];
  let offset = 0;
  for (const character of text) { offset += character.length; boundaries.push(offset); }
  const selected = boundaries.filter((_, index) => index % 127 === 0 || index === boundaries.length - 1);
  for (const units of [...selected].reverse().concat(selected)) {
    const bytes = Buffer.byteLength(text.slice(0, units));
    assert.equal(resolver(1, bytes), units, 'out-of-order repeated lookups preserve the independent encoded prefix offset');
  }
  const probes = boundaries.slice(0, -1).filter((_, index) => index % 127 === 0 || index === 255);
  const definitions = probes.map((start, id) => {
    const end = start + (text.codePointAt(start) > 0xffff ? 2 : 1);
    return { name: 'probe-' + id, startLine: 1, startCol: Buffer.byteLength(text.slice(0, start)),
      endLine: 1, endCol: Buffer.byteLength(text.slice(0, end)) };
  });
  const chunks = buildPythonChunksFromAst(text, { defs: definitions });
  assert.equal(chunks.length, probes.length);
  for (let index = 0; index < chunks.length; index++) {
    const start = probes[index], end = start + (text.codePointAt(start) > 0xffff ? 2 : 1);
    assert.deepEqual([chunks[index].start, chunks[index].end], [start, end]);
    assert.equal(text.slice(chunks[index].start, chunks[index].end), String.fromCodePoint(text.codePointAt(start)));
    const startByte = Buffer.byteLength(text.slice(0, start)), scalarBytes = Buffer.byteLength(text.slice(start, end));
    for (let interior = 1; interior < scalarBytes; interior++) {
      assert.throws(() => resolver(1, startByte + interior), RangeError, 'a checkpoint neighborhood never admits a mid-scalar byte column');
    }
  }
  assert.throws(() => resolver(1, Buffer.byteLength(text) + 1), RangeError);
  assert.throws(() => resolver(1, -1), RangeError);
  assert.throws(() => resolver(1, 1.5), RangeError);
}
const text = 'é漢😀x\r\nnaïve\r\n終😀', lines = buildLineIndex(text);
const resolver = createPythonByteColumnResolver(text, lines);
for (const [line, value] of ['é漢😀x', 'naïve', '終😀'].entries()) {
  let offset = 0;
  for (const character of value) {
    assert.equal(resolver(line + 1, Buffer.byteLength(value.slice(0, offset))), lines[line] + offset);
    offset += character.length;
  }
  assert.equal(resolver(line + 1, Buffer.byteLength(value)), lines[line] + value.length, 'CRLF terminators do not become content columns');
  assert.throws(() => resolver(line + 1, Buffer.byteLength(value) + 1), RangeError);
}
assert.throws(() => resolver(0, 0), RangeError); assert.throws(() => resolver(4, 0), RangeError);
console.log('Python byte-column checkpoints preserve UTF-16 scalar ranges and line bounds');
