#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSuggestTestsReport } from '../../../src/graph/suggest-tests.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(__dirname, '..', '..', 'fixtures', 'tooling', 'suggest-tests');
const graphPath = path.join(fixtureRoot, 'graph-relations.json');
const graphRelations = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

const report = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations,
  repoRoot: fixtureRoot,
  caps: { maxSuggestions: 5, maxCandidates: 10 },
  indexCompatKey: 'compat-suggest-tests-basic',
  now: () => '2026-01-01T00:00:00.000Z'
});

const suggested = report.suggestions.map((entry) => entry.testPath);
assert(
  suggested.includes('tests/unit/lib.test.js'),
  'expected lib.test.js to be suggested'
);

console.log('suggest-tests basic test passed');
