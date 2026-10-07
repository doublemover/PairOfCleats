import assert from 'node:assert/strict';
import { createHandlebarsStructureParser, parseHandlebarsStructure } from '../../../src/shared/handlebars-ast.js';

const parts = Array.from({ length: 128 }, (_, i) => `field${i}`);
const original = parts.join('.');
const source = `{{${original}}}`;
const path = { type: 'PathExpression', parts, original,
  loc: { start: { line: 1, column: 2 }, end: { line: 1, column: source.length - 2 } } };
const document = { type: 'Program', body: [{ type: 'MustacheStatement', path, params: [], escaped: true }] };
const parse = createHandlebarsStructureParser({ loadParser: () => ({ parseWithoutProcessing: () => document }) });
const push = Array.prototype.push;
let primitiveFrames = 0;
let objectFrames = 0;
Array.prototype.push = function(...values) {
  for (const value of values) {
    if (!value || !Object.hasOwn(value, 'node') || !Object.hasOwn(value, 'depth')) continue;
    if (!value.node || typeof value.node !== 'object') primitiveFrames += 1;
    else objectFrames += 1;
  }
  return push.apply(this, values);
};
let result;
try { result = parse(source); }
finally { Array.prototype.push = push; }
console.log(`Handlebars queued frames: primitive${primitiveFrames}, object${objectFrames}`);
assert.equal(result.parser, 'handlebars-parser');
assert.equal(primitiveFrames, 0, 'scalar array entries never become traversal frames');
assert.equal(objectFrames, 2);
assert.deepEqual(result.referenceEntries, [{ value: original, start: 2, end: source.length - 2, line: 0 }]);
assert.equal(parse(source), result, 'warm model reuse is unchanged');
assert.ok(Object.isFrozen(result));
const actual = parseHandlebarsStructure(source);
assert.equal(actual.parser, 'handlebars-parser');
assert.deepEqual(actual.referenceEntries, result.referenceEntries);
console.log('Handlebars frame allocation passed:128 discarded primitive frames omitted, actual vendor ranges and immutable model unchanged');
