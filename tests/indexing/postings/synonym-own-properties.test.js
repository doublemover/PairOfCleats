import assert from 'node:assert/strict';
import { buildSequenceFromTokens } from '../../../src/index/build/tokenization/stream-helpers.js';

const tokens = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'err', 'cfg'];
const expected = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'err', 'error', 'cfg', 'config'];
assert.deepEqual(buildSequenceFromTokens(tokens), expected);
assert.ok(buildSequenceFromTokens(tokens).every((token) => typeof token === 'string'));
const buffer = ['stale'];
assert.deepEqual(buildSequenceFromTokens(tokens, buffer), expected);
assert.deepEqual(tokens, ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'err', 'cfg']);
console.log('synonym own properties test passed');
