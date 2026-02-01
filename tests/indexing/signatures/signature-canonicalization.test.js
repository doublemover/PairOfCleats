#!/usr/bin/env node
import assert from 'node:assert/strict';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { buildTokenizationKey } from '../../../src/index/build/indexer/signatures.js';

const ordered = stableStringifyForSignature({ b: 2, a: 1 });
const reordered = stableStringifyForSignature({ a: 1, b: 2 });
assert.equal(ordered, reordered, 'expected stable stringify to ignore key order');

const undefinedLeft = stableStringifyForSignature({ a: undefined, b: 1 });
const undefinedRight = stableStringifyForSignature({ b: 1 });
assert.equal(undefinedLeft, undefinedRight, 'expected undefined fields to be omitted deterministically');

const setA = new Set(['b', 'a']);
const setB = new Set(['a', 'b']);
const mapA = new Map([['b', 2], ['a', 1]]);
const mapB = new Map([['a', 1], ['b', 2]]);
const bigA = 9007199254740991n;
const bigB = 9007199254740991n;
const complexA = stableStringifyForSignature({ set: setA, map: mapA, big: bigA });
const complexB = stableStringifyForSignature({ map: mapB, big: bigB, set: setB });
assert.equal(complexA, complexB, 'expected canonicalization for Set/Map/BigInt');

const baseRuntime = {
  commentsConfig: {
    licensePattern: /abc/,
    generatedPattern: /@generated/,
    linterPattern: /eslint/
  },
  dictConfig: { splitCase: true },
  postingsConfig: { enablePhraseNgrams: true },
  dictSignature: 'sig-a',
  segmentsConfig: { enabled: true }
};

const tokenKeyA = buildTokenizationKey(baseRuntime, 'code');
const tokenKeyB = buildTokenizationKey({
  ...baseRuntime,
  commentsConfig: {
    ...baseRuntime.commentsConfig,
    licensePattern: /abc/i
  }
}, 'code');
assert.notEqual(tokenKeyA, tokenKeyB, 'expected regex flags to affect tokenization key');

console.log('signature canonicalization tests passed');
