#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getLanguageLexicon } from '../../src/lang/lexicon/index.js';

const unknown = getLanguageLexicon('not-a-real-language');
assert.equal(unknown.resolvedLanguageId, '_generic', 'expected fallback to _generic');
assert.equal(unknown.fallback, true, 'expected fallback marker for unknown language');
assert.ok(unknown.sourceFile, 'expected fallback source file metadata');

const generic = getLanguageLexicon('_generic');
assert.equal(generic.languageId, '_generic', 'expected direct _generic load');
assert.equal(generic.fallback, false, 'expected direct generic load to not mark fallback');

console.log('lexicon fallback test passed');
