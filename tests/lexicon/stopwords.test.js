#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getLanguageLexicon, isLexiconStopword } from '../../src/lang/lexicon/index.js';

const ts = getLanguageLexicon('typescript');
assert.equal(ts.stopwords.relations.has('if'), true, 'relations stopwords must include language keywords');
assert.equal(ts.stopwords.relations.has('console'), false, 'relations stopwords must not include builtins by default');
assert.equal(ts.stopwords.ranking.has('console'), true, 'ranking stopwords should include builtins');
assert.equal(ts.stopwords.chargrams.has('if'), true, 'chargram stopwords should include keywords');
assert.equal(ts.stopwords.chargrams.has('console'), false, 'chargram stopwords should be conservative by default');

assert.equal(isLexiconStopword('typescript', 'if', 'relations'), true, 'isLexiconStopword relations mismatch');
assert.equal(isLexiconStopword('typescript', 'console', 'relations'), false, 'isLexiconStopword relations builtin mismatch');
assert.equal(isLexiconStopword('typescript', 'console', 'ranking'), true, 'isLexiconStopword ranking builtin mismatch');

console.log('lexicon stopwords test passed');
