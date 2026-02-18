#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isCodeEntryForPath,
  isDocsPath,
  isProseEntryForPath,
  shouldPreferDocsProse
} from '../../../src/index/build/mode-routing.js';

assert.equal(
  isProseEntryForPath({ ext: '.json', relPath: 'spec/fixtures/tunes/pricing_tiers.json' }),
  true,
  'expected fixture json to be routed to prose/extracted-prose modes'
);
assert.equal(
  isCodeEntryForPath({ ext: '.json', relPath: 'spec/fixtures/tunes/pricing_tiers.json' }),
  false,
  'expected fixture json to be excluded from code mode'
);

assert.equal(
  isCodeEntryForPath({ ext: '.json', relPath: 'src/config/runtime.json' }),
  true,
  'expected non-fixture json to remain in code mode'
);
assert.equal(
  isProseEntryForPath({ ext: '.json', relPath: 'src/config/runtime.json' }),
  false,
  'expected non-fixture json to stay out of prose mode'
);

assert.equal(
  isCodeEntryForPath({ ext: '.rb', relPath: 'spec/fixtures/helpers/sample.rb' }),
  true,
  'expected fixture source files with code extensions to remain code'
);
assert.equal(
  isProseEntryForPath({ ext: '.rb', relPath: 'spec/fixtures/helpers/sample.rb' }),
  false,
  'expected fixture source files with code extensions to stay out of prose mode'
);

assert.equal(
  isDocsPath('doc/reference/search.json'),
  true,
  'expected doc/ segment to be treated as docs path'
);
assert.equal(
  isDocsPath('guide/documentation/reference/index.html'),
  true,
  'expected documentation/ segment to be treated as docs path'
);
assert.equal(
  shouldPreferDocsProse({ ext: '.json', relPath: 'documentation/site/search.json' }),
  true,
  'expected documentation json assets to be routed to prose mode'
);
assert.equal(
  isCodeEntryForPath({ ext: '.json', relPath: 'doc/reference/search.json' }),
  false,
  'expected doc json assets to stay out of code mode'
);
assert.equal(
  isProseEntryForPath({ ext: '.json', relPath: 'doc/reference/search.json' }),
  true,
  'expected doc json assets to enter prose mode'
);

console.log('mode routing fixture preference test passed');
