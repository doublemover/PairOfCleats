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
  indexCompatKey: 'compat-suggest-tests-witness',
  now: () => '2026-01-01T00:00:00.000Z'
});

const entry = report.suggestions.find((item) => item.testPath === 'tests/unit/lib.test.js');
assert(entry, 'expected lib.test.js suggestion');
assert(entry.witnessPath, 'expected witnessPath to be present');
assert(entry.witnessPath.nodes.length >= 2, 'expected witness path to include at least two nodes');

console.log('suggest-tests witness path test passed');
