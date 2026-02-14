#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractSymbolBaseName } from '../../src/lang/lexicon/index.js';

assert.equal(extractSymbolBaseName('foo.bar'), 'bar');
assert.equal(extractSymbolBaseName('Foo::new'), 'new');
assert.equal(extractSymbolBaseName('obj->method'), 'method');
assert.equal(extractSymbolBaseName('console.log()'), 'log');
assert.equal(extractSymbolBaseName('pkg/module.func,'), 'func');
assert.equal(extractSymbolBaseName('singleName'), 'singleName');
assert.equal(extractSymbolBaseName('  spaced.call  '), 'call');
assert.equal(extractSymbolBaseName(''), '');
assert.equal(extractSymbolBaseName(null), '');

console.log('extract symbol base name test passed');
