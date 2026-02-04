#!/usr/bin/env node
import assert from 'node:assert';
import { renderSuggestTestsReport } from '../../src/retrieval/output/suggest-tests.js';

const report = {
  suggestions: [
    { testPath: 'tests/b.test.js', score: 0.2, reason: 'b', witnessPath: { nodes: [{ path: 'b.js' }] } },
    { testPath: 'tests/a.test.js', score: 0.9, reason: 'a', witnessPath: { nodes: [{ path: 'a.js' }] } }
  ],
  truncation: [{ cap: 'maxSuggestions', limit: 1, observed: 2, omitted: 1 }],
  warnings: [{ code: 'SUGGEST_WARN', message: 'suggest warning' }]
};

const output = renderSuggestTestsReport(report).split('\n');
const firstSuggestion = output.findIndex((line) => line.includes('tests/a.test.js'));
const secondSuggestion = output.findIndex((line) => line.includes('tests/b.test.js'));
assert(firstSuggestion !== -1 && secondSuggestion !== -1, 'expected suggestion lines');
assert(firstSuggestion < secondSuggestion, 'expected suggestions sorted by score');
assert(output.includes('Truncation:'), 'expected truncation section');
assert(output.includes('Warnings:'), 'expected warnings section');

console.log('suggest tests output determinism test passed');
