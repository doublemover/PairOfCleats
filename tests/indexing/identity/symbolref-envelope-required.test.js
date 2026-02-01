#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveSymbolJoinKey } from '../../../src/shared/identity.js';

assert.equal(resolveSymbolJoinKey('raw-symbol'), null, 'expected raw symbol strings to be rejected');
assert.equal(resolveSymbolJoinKey({ symbolKey: 'sk:v1:abc' }), null, 'expected symbolKey to require allowSymbolKey');
const resolved = resolveSymbolJoinKey({ symbolKey: 'sk:v1:abc' }, { allowSymbolKey: true });
assert.equal(resolved?.type, 'symbolKey');
assert.equal(resolved?.key, 'sk:v1:abc');

console.log('symbolRef envelope requirement test passed');
