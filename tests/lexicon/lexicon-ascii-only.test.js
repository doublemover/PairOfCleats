#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeWordlistPayload } from '../../src/lang/lexicon/normalize.js';
import { loadLanguageLexicon } from '../../src/lang/lexicon/load.js';

assert.throws(
  () => normalizeWordlistPayload({
    formatVersion: 1,
    languageId: 'demo',
    keywords: ['if', 'f\u00f3o'],
    literals: ['true']
  }, { strict: true }),
  /non-ASCII token/,
  'expected strict normalization to reject non-ascii entries'
);

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'lexicon-ascii-only');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

await fs.writeFile(path.join(tempRoot, '_generic.json'), JSON.stringify({
  formatVersion: 1,
  languageId: '_generic',
  keywords: ['if'],
  literals: ['true']
}, null, 2));
await fs.writeFile(path.join(tempRoot, 'demo.json'), JSON.stringify({
  formatVersion: 1,
  languageId: 'demo',
  keywords: ['f\u00f3o'],
  literals: ['true']
}, null, 2));

const schemaPath = path.join(root, 'src', 'lang', 'lexicon', 'language-lexicon-wordlist.schema.json');
const loaded = loadLanguageLexicon('demo', {
  wordlistsDir: tempRoot,
  schemaPath,
  cache: false
});
assert.equal(loaded.resolvedLanguageId, '_generic', 'expected invalid non-ascii wordlist to fail-open to generic');

console.log('lexicon ascii only test passed');
