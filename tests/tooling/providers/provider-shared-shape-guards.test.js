#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  createToolingEntry,
  mergeToolingEntry,
  mergeToolingMaps,
  uniqueTypes
} from '../../../src/integrations/tooling/providers/shared.js';

assert.deepEqual(
  uniqueTypes(new Set(['alpha', 'alpha', 'beta'])),
  ['alpha', 'beta'],
  'expected uniqueTypes to accept Set inputs'
);
assert.deepEqual(
  uniqueTypes({ type: 'gamma' }),
  ['gamma'],
  'expected uniqueTypes to accept object-shaped entries'
);

const entry = createToolingEntry();
mergeToolingEntry(entry, {
  returns: [{ type: 'number' }],
  params: {
    x: { type: 'string', source: 'shape-test' }
  }
});
assert.deepEqual(entry.returns, ['number'], 'expected return type merge from object entry');
assert.deepEqual(entry.params.x, ['string'], 'expected param type merge from object entry');

const mergedMap = mergeToolingMaps(new Map(), {
  'src/sample.js::shape': {
    returns: ['boolean'],
    params: {
      y: ['number']
    }
  }
});
const mappedEntry = mergedMap.get('src/sample.js::shape');
assert.ok(mappedEntry, 'expected mergeToolingMaps to accept object records');
assert.deepEqual(mappedEntry.returns, ['boolean']);
assert.deepEqual(mappedEntry.params.y, ['number']);

const mergedFromObjectBase = mergeToolingMaps({}, {
  'src/sample.js::shape-2': {
    returns: ['string']
  }
});
assert.equal(mergedFromObjectBase instanceof Map, true, 'expected mergeToolingMaps to coerce non-Map base');
assert.ok(mergedFromObjectBase.has('src/sample.js::shape-2'));

console.log('tooling shared shape guards test passed');
