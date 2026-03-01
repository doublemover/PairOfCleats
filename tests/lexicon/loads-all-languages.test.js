#!/usr/bin/env node
import assert from 'node:assert/strict';
import { LANGUAGE_REGISTRY } from '../../src/index/language-registry/registry-data.js';
import { getLanguageLexicon } from '../../src/lang/lexicon/index.js';

const ids = Array.from(new Set(LANGUAGE_REGISTRY.map((entry) => entry.id))).sort();
assert.ok(ids.length > 0, 'expected language registry ids');

for (const id of ids) {
  const lexicon = getLanguageLexicon(id);
  assert.equal(lexicon.formatVersion, 1, `expected formatVersion=1 for ${id}`);
  assert.ok(lexicon.keywords instanceof Set, `expected keywords set for ${id}`);
  assert.ok(lexicon.literals instanceof Set, `expected literals set for ${id}`);
}

const unknown = getLanguageLexicon('__unknown_language__');
assert.equal(unknown.resolvedLanguageId, '_generic', 'unknown language should use _generic fallback');
assert.ok(unknown.keywords instanceof Set, 'unknown fallback must include keyword set');

console.log('lexicon loads all languages test passed');
