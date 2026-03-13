#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildTargetLookupIndex,
  findTargetForOffsets,
  findTargetForOffsetsLinear
} from '../../../src/integrations/tooling/providers/lsp/target-index.js';

const targets = [
  {
    id: 'outer',
    virtualRange: { start: 0, end: 300 },
    symbolHint: { name: 'Container', kind: 'class' }
  },
  {
    id: 'inner-alpha',
    virtualRange: { start: 20, end: 80 },
    symbolHint: { name: 'alpha', kind: 'function' }
  },
  {
    id: 'inner-beta',
    virtualRange: { start: 90, end: 160 },
    symbolHint: { name: 'beta', kind: 'function' }
  },
  {
    id: 'inner-beta-shadow',
    virtualRange: { start: 90, end: 160 },
    symbolHint: { name: 'gamma', kind: 'function' }
  },
  {
    id: 'tail',
    virtualRange: { start: 220, end: 260 },
    symbolHint: { name: 'tail', kind: 'function' }
  }
];

const lookup = buildTargetLookupIndex(targets);

const queries = [
  { offsets: { start: 25, end: 35 }, nameHint: 'alpha' },
  { offsets: { start: 110, end: 118 }, nameHint: 'beta' },
  { offsets: { start: 110, end: 118 }, nameHint: 'gamma' },
  { offsets: { start: 230, end: 240 }, nameHint: 'tail' },
  { offsets: { start: 10, end: 280 }, nameHint: null },
  { offsets: { start: 161, end: 170 }, nameHint: null },
  { offsets: { start: 301, end: 305 }, nameHint: null }
];

for (const query of queries) {
  const indexed = findTargetForOffsets(lookup, query.offsets, query.nameHint);
  const linear = findTargetForOffsetsLinear(targets, query.offsets, query.nameHint);
  assert.equal(
    indexed?.id || null,
    linear?.id || null,
    `expected indexed lookup to match linear lookup for ${JSON.stringify(query)}`
  );
}

const tieTargets = [
  {
    id: 'first',
    virtualRange: { start: 0, end: 100 },
    symbolHint: { name: 'dup', kind: 'function' }
  },
  {
    id: 'second',
    virtualRange: { start: 0, end: 100 },
    symbolHint: { name: 'dup', kind: 'function' }
  }
];

const tieLookup = buildTargetLookupIndex(tieTargets);
const tieMatch = findTargetForOffsets(tieLookup, { start: 10, end: 20 }, 'dup');
assert.equal(tieMatch?.id, 'first', 'expected original target order to break exact ties');

console.log('LSP target index test passed');
