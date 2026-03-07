#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyQuery } from '../../../src/retrieval/query-intent.js';
import { parseQueryWithFallback, tokenizePhrase, tokenizeQueryTerms } from '../../../src/retrieval/query.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const goldenDir = path.join(__dirname, 'golden');

const corpusPath = path.join(goldenDir, 'corpus.json');
const expectedPath = path.join(goldenDir, 'expected.json');

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));

const dict = new Set();
const dictOptions = { caseSensitive: false };

const snapshot = corpus.map((entry) => {
  const parseResult = parseQueryWithFallback(entry.query);
  const parsed = parseResult.parsed;
  const includeTokens = tokenizeQueryTerms(parsed.includeTerms, dict, dictOptions);
  const phraseTokens = parsed.phrases
    .map((phrase) => tokenizePhrase(phrase, dict, dictOptions))
    .flat();
  const queryTokens = [...includeTokens, ...phraseTokens];
  const intent = classifyQuery({
    query: entry.query,
    tokens: queryTokens,
    phrases: parsed.phrases,
    parseStrategy: parseResult.strategy,
    parseFallbackReason: parseResult.fallbackReason
  });
  return {
    id: entry.id,
    parseStrategy: parseResult.strategy,
    parseFallbackReason: parseResult.fallbackReason,
    includeTerms: parsed.includeTerms,
    excludeTerms: parsed.excludeTerms,
    phrases: parsed.phrases,
    excludePhrases: parsed.excludePhrases,
    astType: parsed.ast?.type || null,
    intentType: intent.type,
    intentReason: intent.reason,
    intentParseStrategy: intent.parseStrategy,
    intentFallbackReason: intent.parseFallbackReason
  };
});

assert.deepEqual(snapshot, expected, 'golden query corpus drift detected');

console.log('golden query corpus test passed');
