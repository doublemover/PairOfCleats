#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getLanguageLexicon } from '../../src/lang/lexicon/index.js';

const generic = getLanguageLexicon('_generic');
const js = getLanguageLexicon('javascript');
const ts = getLanguageLexicon('typescript');

assert.equal(generic.builtins.has('console'), false, 'generic lexicon should not include language builtins');
assert.equal(js.builtins.has('console'), true, 'javascript lexicon should include console builtin override');
assert.equal(ts.types.has('never'), true, 'typescript lexicon should include language-specific type override');
assert.equal(generic.types.has('never'), false, 'generic lexicon should not include typescript-only overrides');

console.log('lexicon per language overrides test passed');
