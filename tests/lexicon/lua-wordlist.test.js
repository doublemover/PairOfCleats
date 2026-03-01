#!/usr/bin/env node
import assert from 'node:assert/strict';

import { getLanguageLexicon } from '../../src/lang/lexicon/index.js';

const lua = getLanguageLexicon('lua', { allowFallback: false });

assert.equal(lua.resolvedLanguageId, 'lua', 'expected dedicated lua lexicon');
assert.equal(lua.fallback, false, 'lua lexicon should not fall back to _generic');

for (const keyword of ['function', 'local', 'end', 'repeat', 'until', 'goto']) {
  assert.equal(lua.keywords.has(keyword), true, `expected lua keyword ${keyword}`);
}
for (const literal of ['false', 'nil', 'true']) {
  assert.equal(lua.literals.has(literal), true, `expected lua literal ${literal}`);
}
assert.equal(lua.keywords.has('null'), false, 'lua keyword set should not include generic-only null');
assert.equal(lua.modules.has('table'), true, 'expected standard lua module in lexicon');

console.log('lexicon lua wordlist test passed');
