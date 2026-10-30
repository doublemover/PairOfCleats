#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as completeCatalog from 'linguist-languages';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { LINGUIST_LANGUAGES } from '../../../src/index/language-registry/linguist-data.js';
import { buildLinguistRoutingMaps } from '../../../src/index/language-registry/linguist-routing.js';

const supported = new Set(LANGUAGE_REGISTRY.map(language => language.id));
const expected = buildLinguistRoutingMaps(completeCatalog, supported);
const selected = buildLinguistRoutingMaps(LINGUIST_LANGUAGES, supported);
assert.ok(expected.extensions.size > 0 && expected.filenames.size > 0);
assert.deepEqual([...selected.extensions], [...expected.extensions],
  'selected metadata preserves every ordered extension route from the complete vendor catalog');
assert.deepEqual([...selected.filenames], [...expected.filenames],
  'selected metadata preserves every ordered filename route from the complete vendor catalog');
for (const [name, metadata] of Object.entries(LINGUIST_LANGUAGES)) {
  assert.equal(metadata, completeCatalog[name], 'selected entries use the actual vendor data exports');
}
console.log('Selected Linguist metadata preserves the complete supported extension and filename routing policy.');
