import assert from 'node:assert/strict';
import { inferArgType } from '../../../../src/index/type-inference-crossfile/extract.js';

for (const [value, type] of [
  ['123', 'number'], ['-2.5', 'number'], ['true', 'boolean'], ['false', 'boolean'],
  ['null', 'null'], ['undefined', 'undefined'], ['"url://host/#value"', 'string'],
  ["'escaped\\\'quote'", 'string'], ['`template ${value}`', 'string'],
  ['[1, { key: "]" }]', 'array'], ['{ key: [1, 2] }', 'object'],
  ['/* prefix */ [1] /* tail */', 'array'], ['"quoted /* text */" // tail', 'string'],
  ['new Gadget()', 'Gadget'], ['new Namespace.Widget(1, [2])', 'Namespace.Widget'],
  ['new 模块.类()', '模块.类'], ['new 𝒜Thingπ()', '𝒜Thingπ'], ['new Widget世界()', 'Widget世界'],
  ['new Widget', 'Widget'], ['fn(...)', 'function'], ['[...]', 'array'], ['{...}', 'object'], ['`...`', 'string']
]) assert.equal(inferArgType(value), type, `complete argument envelope: ${value}`);

for (const value of [
  'TRUE', 'False', 'NULL', 'Undefined', 'trueValue', 'nullValue',
  '"value" === other', '"value" + other', "'unclosed", '`unclosed',
  '[1][0]', '[1].length', '[1].map(fn)', '{ key: 1 }.key', '{ key: 1 } === other',
  'new Widget().field', 'new Widget()[0]', 'new Widget() + other', 'new Widget()()',
  'new Widget..Nested()', 'new Widget[slot]()',
  'new Widget(]', '[1', '{ key: 1', '/* unclosed', 'fn(...).field',
  '['.repeat(129) + ']'.repeat(129), '"' + 'a'.repeat(65536) + '"'
]) {
  assert.equal(inferArgType(value), null, `unsupported argument cannot inherit a prefix type: ${value.slice(0, 100)}`);
}
assert.equal(inferArgType('new Widget()'), 'Widget', 'a complete constructor call remains a legacy heuristic');
console.log('cross-file argument literal envelope and case identity controls passed');
