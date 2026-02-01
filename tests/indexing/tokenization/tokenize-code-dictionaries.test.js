#!/usr/bin/env node
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';

const assert = (condition, message) => {
  if (!condition) {
    console.error(`tokenize-code-dictionaries test failed: ${message}`);
    process.exit(1);
  }
};

const dictConfig = { segmentation: 'dp', dpMaxTokenLength: 32 };
const postingsConfig = {};

const codeDictWords = new Set(['http', 'request']);
const codeDictWordsByLanguage = new Map([['typescript', new Set(['http', 'request'])]]);
const codeDictLanguages = new Set(['typescript']);

const context = createTokenizationContext({
  dictWords: new Set(),
  dictConfig,
  postingsConfig,
  codeDictWords,
  codeDictWordsByLanguage,
  codeDictLanguages
});

const text = 'httprequest';

const tokensCode = tokenizeChunkText({
  text,
  mode: 'code',
  ext: '.ts',
  languageId: 'typescript',
  context
}).tokens;

assert(tokensCode.includes('http'), 'expected "http" token when code dict is enabled');
assert(tokensCode.includes('request'), 'expected "request" token when code dict is enabled');
assert(!tokensCode.includes('httprequest'), 'expected split tokens to replace the original token');

const tokensCodeOther = tokenizeChunkText({
  text,
  mode: 'code',
  ext: '.go',
  languageId: 'go',
  context
}).tokens;

assert(tokensCodeOther.includes('httprequest'), 'expected token to remain intact for non-gated language');
assert(
  !tokensCodeOther.includes('http') && !tokensCodeOther.includes('request'),
  'expected no code dict split for non-gated language'
);

const contextNoCode = createTokenizationContext({
  dictWords: new Set(),
  dictConfig,
  postingsConfig
});

const tokensNoCode = tokenizeChunkText({
  text,
  mode: 'code',
  ext: '.ts',
  languageId: 'typescript',
  context: contextNoCode
}).tokens;

assert(tokensNoCode.includes('httprequest'), 'expected token to remain intact without code dicts');
assert(
  !tokensNoCode.includes('http') && !tokensNoCode.includes('request'),
  'expected no split without code dicts'
);

const tokensProse = tokenizeChunkText({
  text,
  mode: 'prose',
  ext: '.md',
  languageId: 'typescript',
  context
}).tokens;

assert(tokensProse.includes('httprequest'), 'expected prose token to remain intact');
assert(
  !tokensProse.includes('http') && !tokensProse.includes('request'),
  'expected prose mode to ignore code dicts'
);

console.log('tokenize-code-dictionaries test passed');
