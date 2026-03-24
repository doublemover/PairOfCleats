#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildSuggestTestsReport } from '../../../src/graph/suggest-tests.js';
import { validateSuggestTests } from '../../../src/contracts/validators/analysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(__dirname, '..', '..', 'fixtures', 'tooling', 'suggest-tests');
const graphPath = path.join(fixtureRoot, 'graph-relations.json');
const graphRelations = JSON.parse(fs.readFileSync(graphPath, 'utf8'));

const graphMissing = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations: null,
  tests: ['tests/unit/lib.test.js'],
  repoRoot: fixtureRoot,
  indexCompatKey: 'compat-suggest-tests-graph-missing',
  now: () => '2026-01-01T00:00:00.000Z'
});
assert.equal(graphMissing.fidelity?.source, 'heuristic');
assert.equal(graphMissing.fidelity?.state, 'fallback');
assert.deepEqual(graphMissing.fidelity?.reasonCodes, ['graph_missing']);
assert.equal(graphMissing.suggestions[0]?.fidelity?.matchKind, 'name');
assert.deepEqual(graphMissing.suggestions[0]?.fidelity?.reasonCodes, ['graph_missing']);

const graphNoMatches = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations,
  tests: ['tests/unit/lib.test.js'],
  repoRoot: fixtureRoot,
  caps: {
    maxDepth: 0
  },
  indexCompatKey: 'compat-suggest-tests-graph-no-match',
  now: () => '2026-01-01T00:00:00.000Z'
});
assert.equal(graphNoMatches.fidelity?.source, 'heuristic');
assert.equal(graphNoMatches.fidelity?.state, 'fallback');
assert.deepEqual(graphNoMatches.fidelity?.reasonCodes, ['graph_no_matches']);
assert.deepEqual(graphNoMatches.suggestions[0]?.fidelity?.reasonCodes, ['graph_no_matches']);

const traversalCapped = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations: {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: {
      nodeCount: 3,
      edgeCount: 2,
      nodes: [
        { id: 'tests/unit/lib.test.js', file: 'tests/unit/lib.test.js', out: ['src/support.js'], in: [] },
        { id: 'src/support.js', file: 'src/support.js', out: ['src/lib.js'], in: ['tests/unit/lib.test.js'] },
        { id: 'src/lib.js', file: 'src/lib.js', out: [], in: ['src/support.js'] }
      ]
    }
  },
  tests: ['tests/unit/lib.test.js'],
  repoRoot: fixtureRoot,
  caps: {
    maxEdges: 1
  },
  indexCompatKey: 'compat-suggest-tests-traversal-capped',
  now: () => '2026-01-01T00:00:00.000Z'
});
assert.equal(traversalCapped.fidelity?.source, 'heuristic');
assert.equal(traversalCapped.fidelity?.state, 'fallback');
assert.deepEqual(traversalCapped.fidelity?.reasonCodes, ['graph_no_matches', 'traversal_capped']);
assert.deepEqual(
  traversalCapped.suggestions[0]?.fidelity?.reasonCodes,
  ['graph_no_matches', 'traversal_capped']
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-tests-fidelity-'));
fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
fs.mkdirSync(path.join(tempRoot, 'tests'), { recursive: true });
fs.writeFileSync(path.join(tempRoot, 'src', 'lib.js'), 'export const lib = 1;\n', 'utf8');
fs.writeFileSync(path.join(tempRoot, 'tests', 'lib.test.js'), 'test("lib", () => {});\n', 'utf8');
fs.writeFileSync(path.join(tempRoot, 'tests', 'other.test.js'), 'test("other", () => {});\n', 'utf8');

const candidateTruncated = buildSuggestTestsReport({
  changed: ['src/lib.js'],
  graphRelations: null,
  repoRoot: tempRoot,
  caps: {
    maxCandidates: 1
  },
  indexCompatKey: 'compat-suggest-tests-candidate-truncated',
  now: () => '2026-01-01T00:00:00.000Z'
});
assert.equal(candidateTruncated.fidelity?.source, 'heuristic');
assert.equal(candidateTruncated.fidelity?.state, 'fallback');
assert.deepEqual(candidateTruncated.fidelity?.reasonCodes, ['graph_missing', 'candidate_truncated']);
assert.deepEqual(
  candidateTruncated.suggestions[0]?.fidelity?.reasonCodes,
  ['graph_missing', 'candidate_truncated']
);

const validation = validateSuggestTests(candidateTruncated);
assert.equal(validation.ok, true, `expected fidelity-rich suggest-tests output to validate: ${validation.errors.join(', ')}`);

console.log('suggest-tests fidelity test passed');
