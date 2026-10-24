import assert from 'node:assert/strict';
import { inferTypeMetadata } from '../../../../src/index/type-inference.js';
import { extractParamTypes } from '../../../../src/index/type-inference-crossfile/extract.js';

// Authored only. Actual local heuristic and downstream parameter facts; source
// guard strings are data and are never evaluated or passed to a compiler.
const params = ['πvalue', 'value', '世界', '𝒜item', 'item', 'x世界', 'x', 'later'];
const text = [
  'if (typeof πvalue === "number") {}',
  'if (世界 instanceof 模块.类) {}',
  'if (𝒜item === null) {}',
  'if (Array . isArray(x世界)) {}',
  'if (scope . value === null || later === null) {}'
].join('\n');
const types = (metadata, name) => (metadata?.params?.[name] || []).map(entry => entry.type);
for (const languageId of ['javascript', 'typescript', 'jsx', 'tsx']) {
  const metadata = inferTypeMetadata({ docmeta: { params }, chunkText: text, languageId });
  const expected = { πvalue: ['number'], 世界: ['模块.类'], '𝒜item': ['null'], x世界: ['array'], later: ['null'] };
  for (const [name, values] of Object.entries(expected)) assert.deepEqual(types(metadata, name), values, languageId + ':' + name);
  for (const name of ['value', 'item', 'x']) assert.deepEqual(types(metadata, name), [], name + ' cannot borrow a longer or qualified binding suffix');
  const projected = extractParamTypes({ docmeta: { params, inferredTypes: metadata } });
  for (const [name, values] of Object.entries(expected)) assert.deepEqual(projected.paramTypes[name], values, name + ' survives actual cross-file parameter projection');
}
const negatives = [
  'if (scope.value === null) {}', 'if (scope . value instanceof Class) {}',
  'if (this.#value === null) {}', 'if (this.#value instanceof Class) {}',
  'if (scope.Array.isArray(value)) {}', 'if (scope . Array.isArray(value)) {}',
  'if (value === nullValue) {}', 'if (value === null世界) {}', 'if (value === null . member) {}',
  'if (notypeof value === "string") {}', 'if (typeof value === "Number") {}',
  'if (typeof value === "custom") {}', 'if (typeof value === \'number") {}',
  'if (value instanceof namespace . Class) {}', 'if (value instanceof factory()) {}',
  'if (value instanceof constructors[index]) {}'
];
for (const chunkText of negatives) {
  const metadata = inferTypeMetadata({ docmeta: { params: ['value'] }, chunkText, languageId: 'javascript' });
  assert.deepEqual(types(metadata, 'value'), [], chunkText);
}
const qualified = inferTypeMetadata({ docmeta: { params: ['value'] }, chunkText: 'if (value instanceof Namespace.Type世界) {}', languageId: 'javascript' });
assert.deepEqual(types(qualified, 'value'), ['Namespace.Type世界'], 'constructor type identity cannot lose its Unicode suffix');
for (const languageId of ['python', 'java', 'csharp', 'ruby']) {
  const metadata = inferTypeMetadata({ docmeta: { params: ['value', 'declared'], paramTypes: { declared: 'Custom' } },
    chunkText: 'if (value == null) {}\nif (Array.isArray(value)) {}\nif (typeof value === "string") {}', languageId });
  assert.deepEqual(types(metadata, 'value'), [], languageId + ' does not borrow JavaScript guard semantics');
  assert.deepEqual(types(metadata, 'declared'), ['Custom'], 'language gating preserves independent annotations');
}
const again = inferTypeMetadata({ docmeta: { params: ['value'] }, chunkText: 'if (typeof value === "boolean") {}', languageId: 'javascript' });
assert.deepEqual(types(again, 'value'), ['boolean'], 'shared regular-expression state is reset between chunks and rejected candidates');
console.log('local conditional facts preserve bare binding, Unicode and language identity');
