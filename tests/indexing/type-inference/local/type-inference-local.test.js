#!/usr/bin/env node
import assert from 'node:assert/strict';
import { inferTypeMetadata } from '../../../../src/index/type-inference.js';

const hasType = (bucket, name, type) => (
  Array.isArray(bucket?.[name]) && bucket[name].some((entry) => entry.type === type)
);

const docmeta = {
  params: ['foo', 'count', 'bar'],
  paramTypes: {
    foo: 'string',
    count: 'integer'
  },
  paramDefaults: {
    bar: 'true'
  }
};

const chunkText = [
  'const local = 3;',
  'if (typeof foo === "string") { console.log(foo); }',
  'if (bar === null) { console.log(bar); }'
].join('\n');

const metadata = inferTypeMetadata({ docmeta, chunkText, languageId: 'javascript' });
assert.ok(metadata, 'expected type metadata to be inferred');
assert.ok(hasType(metadata.params, 'foo', 'string'), 'expected string param type for foo');
assert.ok(hasType(metadata.params, 'count', 'number'), 'expected integer param to normalize to number');
assert.ok(hasType(metadata.params, 'bar', 'boolean'), 'expected default literal to infer boolean');
assert.ok(hasType(metadata.locals, 'local', 'number'), 'expected local literal to infer number');

console.log('type inference local metadata test passed');
