#!/usr/bin/env node
import assert from 'node:assert/strict';
import { stableStringify, stableStringifyForSignature } from '../../src/shared/stable-json.js';

const value = Object.create(null);
value.z = { z: 2, a: 1 };
value.a = [{ z: 4, a: 3 }];
value.__proto__ = { z: 6, a: 5 };
value.constructor = { z: 8, a: 7 };
for (const serialize of [stableStringify, stableStringifyForSignature]) {
  const encoded = serialize(value);
  assert.equal(encoded, serialize(JSON.parse(JSON.stringify(value))),
    'dictionary prototype and JSON round trip cannot change canonical meaning');
  assert.equal(encoded, '{"__proto__":{"a":5,"z":6},"a":[{"a":3,"z":4}],"constructor":{"a":7,"z":8},"z":{"a":1,"z":2}}');
  assert.equal(Object.hasOwn(JSON.parse(encoded), '__proto__'), true);
  assert.equal(serialize(new Date('2026-01-01T00:00:00.000Z')), '"2026-01-01T00:00:00.000Z"');
}
console.log('stable JSON canonicalizes null-prototype and prototype-named record fields across publication');
