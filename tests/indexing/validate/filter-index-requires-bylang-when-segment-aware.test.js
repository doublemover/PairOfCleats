#!/usr/bin/env node
import { buildFilterIndex } from '../../../src/retrieval/filter-index.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

let threw = false;
try {
  buildFilterIndex([
    {
      id: 0,
      file: 'src/example.js',
      ext: '.js',
      metaV2: {}
    }
  ]);
} catch (err) {
  threw = true;
  if (!String(err?.message || '').includes('missing effective language')) {
    fail(`Unexpected error: ${err?.message || err}`);
  }
}

if (!threw) {
  fail('Expected buildFilterIndex to reject missing effective language id.');
}

console.log('filter index requires byLang when segment-aware');
