import assert from 'node:assert/strict';
import { inferTypeMetadata } from '../../../../src/index/type-inference.js';
import { extractParamTypes, extractReturnTypes } from '../../../../src/index/type-inference-crossfile/extract.js';

// Authored only: invoke local enrichment and its actual cross-file metadata
// consumers. These source annotations do not execute a compiler or provider.
const infer = (paramTypes, languageId = 'typescript') => inferTypeMetadata({
  docmeta: { params: Object.keys(paramTypes), paramTypes }, chunkText: '', languageId
});
const types = (inferred, name) => (inferred.params[name] || []).map(entry => entry.type);
const literalAnnotations = {
  pipe: '"a|b"',
  angle: '"A<B>"',
  bracket: '"A[B]"',
  escaped: '"a\\"|b"',
  template: '`a|${T}`',
  object: '{ value: "a|b"; other: Number }',
  generic: 'Wrapper<"a,b", Other>',
  nested: 'Map<string, Array<number | null>>',
  malformed: 'Map<string] | Number',
  unclosed: '"a|b',
  malformedOptional: 'Broken[?',
  callable: '(value: A) => B | C',
  conditional: 'T extends U ? A : B | C'
};
const literal = infer(literalAnnotations);
for (const [name, annotation] of Object.entries(literalAnnotations)) {
  assert.deepEqual(types(literal, name), [annotation], name + ' retains its whole literal/container/unsupported expression');
}
const projected = extractParamTypes({ docmeta: { params: Object.keys(literalAnnotations), inferredTypes: literal } });
for (const [name, annotation] of Object.entries(literalAnnotations)) {
  assert.equal(projected.paramTypes[name].length, 1, name + ' cannot acquire fragment types in cross-file projection');
  if (!['object', 'generic', 'nested', 'callable', 'conditional'].includes(name)) assert.equal(projected.paramTypes[name][0], annotation);
}

const pythonAnnotations = {
  elements: 'list[typing.Optional[str]]',
  nullableList: 'typing.Optional[list[str]]',
  mapping: 'dict[str, Optional[int]]',
  wholeUnion: 'typing.Union[list[Optional[str]], tuple[int, str]]',
  adjacent: 'Optional[int] | list[str]',
  extension: 'typing_extensions.Optional[list[str]]',
  custom: 'custom.typing.Optional[str]',
  wrongEnclosure: 'Optional<int>',
  quoted: 'typing.Union["a,b|c", list[str]]'
};
const python = infer(pythonAnnotations, 'python');
assert.deepEqual(types(python, 'elements'), [pythonAnnotations.elements]);
assert.deepEqual(types(python, 'mapping'), [pythonAnnotations.mapping]);
assert.deepEqual(types(python, 'nullableList'), [pythonAnnotations.nullableList, 'list[str]', 'None']);
assert.deepEqual(types(python, 'extension'), [pythonAnnotations.extension, 'list[str]', 'None']);
assert.deepEqual(types(python, 'wholeUnion'), [pythonAnnotations.wholeUnion, 'list[Optional[str]]', 'tuple[int, str]']);
assert.deepEqual(types(python, 'adjacent'), [pythonAnnotations.adjacent, 'Optional[int]', 'list[str]', 'int', 'None'],
  'an Optional constructor cannot consume the later list closing bracket');
assert.deepEqual(types(python, 'custom'), [pythonAnnotations.custom], 'only the standard constructor owner supplies nullability');
assert.deepEqual(types(python, 'wrongEnclosure'), [pythonAnnotations.wrongEnclosure], 'an angle enclosure cannot become a Python constructor');
assert.deepEqual(types(python, 'quoted'), [pythonAnnotations.quoted, '"a,b|c"', 'list[str]']);
assert.notDeepEqual(types(python, 'elements'), types(python, 'nullableList'), 'element and container nullability remain distinct');

const union = infer({ simple: 'A | B', parenthesized: 'A | ((value: B) => C)' });
assert.deepEqual(types(union, 'simple'), ['A | B', 'A', 'B']);
assert.deepEqual(types(union, 'parenthesized'), ['A | ((value: B) => C)', 'A', '((value: B) => C)']);
const aliases = infer({ lower: 'float', custom: 'Float', inherited: 'constructor', prototype: '__proto__', boxed: 'Number' }, 'javascript');
assert.deepEqual(types(aliases, 'lower'), ['number']);
assert.deepEqual(types(aliases, 'custom'), ['Float']);
assert.deepEqual(types(aliases, 'inherited'), ['constructor']);
assert.deepEqual(types(aliases, 'prototype'), ['__proto__']);
assert.deepEqual(types(aliases, 'boxed'), ['number']);
const pythonAliases = infer({ lower: 'boolean', custom: 'Boolean', inherited: 'toString' }, 'python');
assert.deepEqual(types(pythonAliases, 'lower'), ['bool']);
assert.deepEqual(types(pythonAliases, 'custom'), ['Boolean']);
assert.deepEqual(types(pythonAliases, 'inherited'), ['toString']);

const returned = inferTypeMetadata({ docmeta: { returnType: 'Array<"a|b">', fields: [{ name: 'values', type: 'Array<"a|b">' }] },
  chunkText: '', languageId: 'typescript' });
assert.deepEqual(returned.returns.map(entry => entry.type), ['Array<"a|b">']);
assert.deepEqual(returned.fields.values.map(entry => entry.type), ['Array<"a|b">']);
assert.deepEqual(extractReturnTypes({ docmeta: { inferredTypes: returned } }), ['Array<"a|b">']);
const tooDeep = 'Array<'.repeat(129) + 'Value' + '>'.repeat(129);
assert.deepEqual(types(infer({ deep: tooDeep }), 'deep'), [tooDeep], 'bounded structural inspection preserves the complete annotation');
console.log('local type candidates retain literal identity, generic ownership and standard constructor boundaries');
