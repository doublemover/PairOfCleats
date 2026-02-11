#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseHash64 } from '../../../src/shared/token-id.js';

const asHex = (value) => value.toString(16);

assert.equal(asHex(parseHash64('0x2a')), '2a', 'hex should parse');
assert.equal(asHex(parseHash64('2a')), '2a', 'plain hex should parse');
assert.equal(asHex(parseHash64('0x2an')), '2a', 'hex BigInt literal should parse');
assert.equal(asHex(parseHash64('2an')), '2a', 'plain BigInt-literal-style hex should parse');
assert.equal(asHex(parseHash64('0n')), '0', 'zero BigInt literal should parse');

// Regression: malformed "0xn" input must never throw.
assert.equal(asHex(parseHash64('0xn')), '0', 'malformed hex fragment should resolve to zero');
assert.equal(asHex(parseHash64('n')), '0', 'bare suffix should resolve to zero');

console.log('token-id parse resilience test passed');
