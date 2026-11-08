import assert from 'node:assert/strict';
import { parseJavaScriptAst, getJavaScriptSyntaxIdentity } from '../../../src/lang/javascript/parse.js';
import { buildCodeRelations } from '../../../src/lang/javascript/relations.js';
import { extractDocMeta } from '../../../src/lang/javascript/docmeta.js';
import { inferTypeMetadata } from '../../../src/index/type-inference.js';
import { projectJsTsLiteral } from '../../../src/lang/js-ts/literal.js';
import { createCallSites } from '../../../src/index/build/artifacts/writers/call-sites.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

const cases = [
  ['1n', 'bigint', '1'], ['90071992547409931234567890n', 'bigint', '90071992547409931234567890'],
  ['1e400', 'number', null], ['null', 'null', 'null'], ['false', 'boolean', 'false'],
  ['"a b"', 'string', '"a b"'], ['/a+/gu', 'regexp', null], ['-2', 'number', '-2'],
  ['-0', 'number', '-0'], ['-10n', 'bigint', '-10'], ['1_000', 'number', '1000'],
  ['0xffn', 'bigint', '255'], ['1e2', 'number', '100'], ['+2', 'number', '2']
];
const source = cases.map(([value], index) => `function f${index}(value = ${value}) { sink${index}(${value}); }`).join('\n')
  + '\nfunction unrelated() { intact(); }';
for (const parser of ['acorn', 'babel']) {
  const ast = parseJavaScriptAst(source, { parser });
  assert.equal(getJavaScriptSyntaxIdentity(ast)?.family, parser, 'the actual requested parser must supply the dialect');
  const relations = buildCodeRelations(source, 'literal.js', { ast });
  assert.equal(relations.callDetails.length, cases.length + 1, 'unsupported scalars cannot discard other relations');
  for (let index = 0; index < cases.length; index++) {
    const [raw, kind, representation] = cases[index];
    const start = source.indexOf(`function f${index}(`);
    const end = source.indexOf('\n', start);
    const meta = extractDocMeta(source, { name: `f${index}`, start, end: end < 0 ? source.length : end }, relations);
    const literal = meta.paramDefaultLiterals.value;
    assert.equal(literal.kind, kind);
    assert.equal(literal.scalar?.representation ?? null, representation);
    assert.equal(source.slice(literal.range.start, literal.range.end), raw);
    assert.equal(literal.rawPreview, raw);
    const detail = relations.callDetails.find(detail => detail.callee === `sink${index}`);
    assert.deepEqual({ ...detail.argLiterals[0], range: null }, { ...literal, range: null },
      'default and call dialect normalization agree apart from occurrence ranges');
    // Each source occurrence owns its own range.
    assert.equal(source.slice(detail.argLiterals[0].range.start, detail.argLiterals[0].range.end), raw);
    const inferred = inferTypeMetadata({ docmeta: meta, chunkText: '', languageId: 'javascript' });
    const types = inferred?.params?.value?.map(entry => entry.type) || [];
    assert.deepEqual(types, kind === 'regexp' ? [] : [kind]);
    assert.equal(detail.args[0] === 'null', kind === 'null');
  }
  const rows = JSON.parse(JSON.stringify(createCallSites({ chunks: [{ file: 'literal.js', chunkUid: 'literals',
    lang: 'javascript', codeRelations: relations }] })));
  assert.equal(validateArtifact('call_sites', rows).ok, true);
  assert.equal(rows.find(row => row.calleeRaw === 'sink1').extensions.argLiterals[0].scalar.representation,
    '90071992547409931234567890');
  const invalid = structuredClone(rows); invalid[0].extensions.argLiterals[0].scalar.type = 'null';
  assert.equal(validateArtifact('call_sites', invalid).ok, false);
}
let conversions = 0;
const value = { toJSON() { conversions++; throw new Error('must not execute'); },
  toString() { conversions++; throw new Error('must not execute'); } };
assert.equal(projectJsTsLiteral({ type: 'Literal', value }).kind, 'unsupported');
assert.equal(projectJsTsLiteral({ type: 'Literal', value, regex: { pattern: 'x', flags: '' } }).kind, 'regexp');
assert.equal(conversions, 0);
const getter = { type: 'Literal', get value() { throw new Error('must not execute'); } };
assert.equal(projectJsTsLiteral(getter).kind, 'unsupported');
const huge = projectJsTsLiteral({ type: 'BigIntLiteral', value: '1'.repeat(5000), start: 0, end: 5001 }, '1'.repeat(5000) + 'n');
assert.equal(huge.kind, 'bigint'); assert.equal(huge.scalar, null); assert.equal(huge.rawPreview.length, 80);
assert.equal(huge.rawTruncated, true); assert.ok(JSON.stringify(huge).length < 400);
console.log('owned ESTree/Babel literals preserve scalar kind, precision, source and bounded JSON evidence');
