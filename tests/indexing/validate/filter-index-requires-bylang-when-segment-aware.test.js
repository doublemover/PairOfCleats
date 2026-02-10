#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';

const index = buildFilterIndex([
  {
    id: 0,
    file: 'src/example.js',
    ext: '.js',
    metaV2: {}
  }
]);
assert.ok(index.byLang instanceof Map, 'expected byLang map');
assert.ok(index.byLang.get('unknown')?.has(0), 'expected missing effective language id to map to unknown bucket');

console.log('filter index requires byLang when segment-aware');
