import assert from 'node:assert/strict';
import { inferTypeMetadata } from '../../../../src/index/type-inference.js';
import { extractParamTypes } from '../../../../src/index/type-inference-crossfile/extract.js';

// Authored only: actual local enrichment and downstream type projection. The
// default/source expressions are data and are never parsed by a native process
// or evaluated, including constructor/builtin-looking controls.
const defaults = (paramDefaults, languageId = 'javascript') => inferTypeMetadata({
  docmeta: { params: Object.keys(paramDefaults), paramDefaults }, chunkText: '', languageId
});
const types = (metadata, name) => (metadata?.params?.[name] || []).map(entry => entry.type);
const positive = defaults({
  url: '"https://example.test/a#fragment"',
  escaped: '"a\\"#b,c"',
  template: '`a//b#c`',
  array: '["https://example.test", "a#b", "c\\"d,e", 1] // note',
  object: '{ outer: { nested: 1 }, text: "https://host", local } /* note */',
  grouped: '((42))',
  construction: 'new Widget()',
  scalar: 'true // note'
});
for (const name of ['url', 'escaped', 'template']) assert.deepEqual(types(positive, name), ['string']);
assert.deepEqual(types(positive, 'array'), ['array']);
assert.deepEqual(positive.params.array[0].elements, ['string', 'number'], 'quoted comment/comma markers cannot truncate or split array elements');
assert.deepEqual(types(positive, 'object'), ['object']);
assert.deepEqual(positive.params.object[0].shape.keys, ['outer', 'text', 'local'], 'nested property names are not keys of their parent object');
assert.deepEqual(types(positive, 'grouped'), ['number']);
assert.deepEqual(types(positive, 'construction'), ['Widget']);
assert.deepEqual(types(positive, 'scalar'), ['boolean']);
const expressions = {
  arrayRead: '[1, 2].length',
  objectRead: '({ value: 1 }).value',
  comparison: '"value" === candidate',
  arrayChoice: '[1] || candidate',
  callResult: 'new Widget().value',
  upperBoolean: 'TRUE',
  upperNull: 'Null',
  unclosedString: '"unterminated',
  unclosedArray: '[1, 2',
  unclosedComment: '[1] /* missing',
  oversized: '"' + 'x'.repeat(65536) + '"'
};
const unsupported = defaults(expressions);
for (const name of Object.keys(expressions)) assert.deepEqual(types(unsupported, name), [], name + ' cannot inherit a literal prefix type');
const downstream = extractParamTypes({ docmeta: { params: Object.keys(expressions), inferredTypes: unsupported } });
assert.deepEqual(Object.keys(downstream.paramTypes), [], 'no rejected prefix fact reaches cross-file parameter metadata');

const python = defaults({
  truth: 'True', nothing: 'None', variable: 'true',
  dictionary: '{"a#b": "https://host", "outer": {"nested": 1}} # note',
  emptyDictionary: '{}', set: '{1, 2}', unpackedDictionary: '{**mapping}',
  grouped: '(1)', tuple: '(1,)', emptyTuple: '()', nestedTuple: '((1, 2))',
  lambda: '(lambda x, y: x + y)', lambdaSet: '{lambda x: x}', bareTuple: '1,',
  listCall: 'list(source)', listElement: 'list(source)[0]', floorDivision: '1 // 2'
}, 'python');
assert.deepEqual(types(python, 'truth'), ['bool']);
assert.deepEqual(types(python, 'nothing'), ['None']);
assert.deepEqual(types(python, 'variable'), []);
for (const name of ['dictionary', 'emptyDictionary', 'unpackedDictionary']) assert.deepEqual(types(python, name), ['dict']);
assert.deepEqual(python.params.dictionary[0].shape.keys, ['a#b', 'outer']);
assert.deepEqual(types(python, 'set'), ['set']);
assert.deepEqual(types(python, 'grouped'), ['int']);
for (const name of ['tuple', 'emptyTuple', 'nestedTuple']) assert.deepEqual(types(python, name), ['tuple']);
for (const name of ['lambda', 'lambdaSet', 'bareTuple', 'listElement', 'floorDivision']) assert.deepEqual(types(python, name), [],
  name + ' remains outside this bounded literal profile');
assert.deepEqual(types(python, 'listCall'), ['list'], 'existing complete builtin-looking constructor heuristic remains explicit');

const local = inferTypeMetadata({ docmeta: {}, languageId: 'javascript', chunkText: [
  'const prefix = [1, 2].length;', 'const alias = prefix;',
  'const comparison = "value" === unknown;', 'const compared = comparison;',
  'const whole = ["http://host", 3];', 'const copied = whole;'
].join('\n') });
for (const name of ['prefix', 'alias', 'comparison', 'compared']) assert.deepEqual(local.locals?.[name] || [], []);
assert.ok(local.locals.whole.some(entry => entry.type === 'array'));
assert.ok(local.locals.copied.some(entry => entry.type === 'array' && entry.source === 'flow'));
const namedBoolean = inferTypeMetadata({ docmeta: { params: ['TRUE'], paramTypes: { TRUE: 'number' } },
  chunkText: 'const value = TRUE;', languageId: 'javascript' });
assert.deepEqual(namedBoolean.locals.value.map(entry => entry.type), ['number'], 'case-distinct binding evidence cannot be replaced by a Boolean literal guess');
const pythonName = inferTypeMetadata({ docmeta: { params: ['true'], paramTypes: { true: 'str' } },
  chunkText: 'value = true', languageId: 'python' });
assert.deepEqual(pythonName.locals.value.map(entry => entry.type), ['str']);
console.log('local literal ownership preserves complete expressions, quoted comments, container shape and source-order alias facts');
