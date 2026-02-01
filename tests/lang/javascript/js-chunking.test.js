#!/usr/bin/env node
import { buildJsChunks } from '../../../src/lang/javascript.js';

const source = [
  'export function alpha() {}',
  'class Foo {',
  '  method() {}',
  '  static bar() {}',
  '}',
  'const beta = () => {};',
  'export default function gamma() {}',
  'exports.qux = function() {};'
].join('\n');

const chunks = buildJsChunks(source) || [];
const names = new Set(chunks.map((chunk) => chunk.name));

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

expect(names.has('alpha'), 'Missing exported function chunk (alpha).');
expect(names.has('Foo'), 'Missing class chunk (Foo).');
expect(names.has('Foo.method'), 'Missing class method chunk (Foo.method).');
expect(names.has('Foo.bar'), 'Missing class method chunk (Foo.bar).');
expect(names.has('beta'), 'Missing arrow function chunk (beta).');
expect(names.has('gamma'), 'Missing default function chunk (gamma).');
expect(names.has('exports.qux') || names.has('qux'), 'Missing assignment function chunk (exports.qux).');

console.log('JS chunking test passed.');
