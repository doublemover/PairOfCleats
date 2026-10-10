import assert from 'node:assert/strict';
import { parseJavaScriptAst } from '../../../src/lang/javascript/parse.js';
import { prepareTypeScriptSyntax } from '../../../src/lang/typescript/syntax-context.js';
import { createSemanticCollector } from '../../../src/index/semantic/javascript-collector.js';
import { createTypeScriptSemanticCollector } from '../../../src/index/semantic/typescript-collector.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { validateSemanticRecord } from '../../../src/contracts/validators/semantic.js';

const common = [
  'import { input as incoming } from "dep";',
  'let a, b; ({ a: a = fallback(), ...b } = incoming);',
  'a += 1;',
  'const out = tag`value ${a} ${b}`;',
  'const promise = import("./m.js", { with: { type: "json" } });',
  'incoming?.method?.(a, ...b);',
  'class Box { #value = a; method() { return this.#value; } static { a++; } }',
  'export { incoming as renamed };'
].join('\n');
for (const language of ['javascript', 'typescript']) {
  const text = common + (language === 'typescript' ? '\nimport type { Shape } from "types"; const typed: Shape = incoming;' : '');
  const source = createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'roles',
    path: language === 'typescript' ? 'input.ts' : 'input.js', language }).manifest;
  const syntax = language === 'typescript' ? prepareTypeScriptSyntax(text, { ext: '.ts' }) : null;
  const create = language === 'typescript' ? createTypeScriptSemanticCollector : createSemanticCollector;
  const input = { ast: syntax?.sourceFile || parseJavaScriptAst(text), ts: syntax?.ts,
    source, partitionId: 'sy1:' + 'a'.repeat(64) };
  const collect = batchRows => {
    const collector = create(input, { batchRows, batchBytes: 8192 });
    const rows = [...collector.batches].flatMap(batch => batch.rows);
    for (const entry of rows) assert.equal(validateSemanticRecord(entry.family, entry.row,
      { sourceLength: text.length, structuralSlots: collector.structuralSlots }).ok, true, JSON.stringify(entry));
    assert.equal(collector.summary.state, 'complete');
    return rows;
  };
  const rows = collect(7);
  assert.deepEqual(rows, collect(43), 'batch size cannot change occurrence identities or roles');
  const nodes = rows.filter(entry => entry.family === 'node').map(entry => entry.row);
  const operands = rows.filter(entry => entry.family === 'operand').map(entry => entry.row);
  const at = (token, after) => {
    const start = text.indexOf(token, text.indexOf(after));
    return nodes.find(node => node.kind === 'occurrence' && node.span[0] === start && node.span[1] === start + token.length);
  };
  assert.deepEqual(at('a', 'a = fallback').data.roles, ['write', 'reference']);
  assert.deepEqual(at('b', '...b }').data.roles, ['write', 'reference']);
  assert.deepEqual(at('a', 'a += 1').data.roles, ['read', 'write', 'reference']);
  assert.ok(at('fallback', 'fallback()').data.roles.includes('call'));
  assert.deepEqual(at('input', 'import {').data.roles, ['import', 'reference']);
  assert.deepEqual(at('renamed', 'export {').data.roles, ['export', 'property']);
  const tag = nodes.find(node => node.kind === 'expression' && node.data.invocationKind === 'tag');
  assert.deepEqual(operands.filter(row => row.parent.localId === tag.id && row.slot === 'argument').map(row => row.ordinal), [0, 1]);
  const dynamic = nodes.find(node => node.kind === 'expression' && node.data.invocationKind === 'import');
  assert.equal(dynamic.data.syntacticArgumentCount, 2);
  assert.deepEqual(operands.filter(row => row.parent.localId === dynamic.id && row.slot === 'argument').map(row => row.ordinal), [0, 1]);
  assert.ok(operands.some(row => row.flags.includes('optional')));
  if (language === 'javascript') {
    const privateNames = nodes.filter(node => node.kind === 'occurrence' && text.slice(...node.span).includes('#value'));
    assert.equal(privateNames.length, 2, 'private names have one source occurrence per use');
    assert.ok(privateNames[0].data.roles.includes('definition'));
  } else {
    assert.ok(at('Shape', 'import type').data.flags.includes('typeOnly'));
    assert.ok(at('Shape', 'typed:').data.flags.includes('typeOnly'));
    assert.ok(!at('incoming', '= incoming;').data.flags.includes('typeOnly'));
  }
}
console.log('JS/TS structured invocation operands, pattern writes, private names and type-only roles passed');
