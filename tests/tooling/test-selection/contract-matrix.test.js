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

{
  const report = buildSuggestTestsReport({
    changed: ['src/lib.js'],
    graphRelations,
    repoRoot: fixtureRoot,
    caps: { maxSuggestions: 5, maxCandidates: 10 },
    indexCompatKey: 'compat-suggest-tests-basic',
    now: () => '2026-01-01T00:00:00.000Z'
  });

  assert.equal(report.fidelity?.source, 'graph');
  assert.equal(report.fidelity?.state, 'complete');
  assert.deepEqual(report.fidelity?.reasonCodes, []);
  const libSuggestion = report.suggestions.find((entry) => entry.testPath === 'tests/unit/lib.test.js');
  assert.ok(libSuggestion, 'expected lib.test.js to be suggested');
  assert.equal(libSuggestion?.fidelity?.source, 'graph');
  assert.equal(libSuggestion?.fidelity?.matchKind, 'graph-distance');
}

{
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
  assert(entry.witnessPath.nodes.length >= 2);
  assert.equal(entry.fidelity?.graphDistance, 1);
  assert.deepEqual(entry.fidelity?.reasonCodes, []);
}

{
  const deterministicGraph = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: {
      nodeCount: 2,
      edgeCount: 1,
      nodes: [
        { id: 'tests/a.test.js', file: 'tests/a.test.js', out: ['src/lib.js'], in: [] },
        { id: 'src/lib.js', file: 'src/lib.js', out: [], in: ['tests/a.test.js'] }
      ]
    }
  };
  const now = () => '2026-01-01T00:00:00.000Z';
  const reportA = buildSuggestTestsReport({
    changed: ['src/lib.js'],
    graphRelations: deterministicGraph,
    tests: ['tests/a.test.js'],
    caps: { maxSuggestions: 5 },
    indexCompatKey: 'compat-suggest-tests-determinism',
    now
  });
  const reportB = buildSuggestTestsReport({
    changed: ['src/lib.js'],
    graphRelations: deterministicGraph,
    tests: ['tests/a.test.js'],
    caps: { maxSuggestions: 5 },
    indexCompatKey: 'compat-suggest-tests-determinism',
    now
  });
  assert.deepStrictEqual(reportA, reportB);
}

{
  const boundedGraph = {
    version: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: {
      nodeCount: 4,
      edgeCount: 3,
      nodes: [
        { id: 'tests/a.test.js', file: 'tests/a.test.js', out: ['src/lib.js'], in: [] },
        { id: 'tests/b.test.js', file: 'tests/b.test.js', out: ['src/lib.js'], in: [] },
        { id: 'tests/c.test.js', file: 'tests/c.test.js', out: ['src/lib.js'], in: [] },
        { id: 'src/lib.js', file: 'src/lib.js', out: [], in: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'] }
      ]
    }
  };

  const report = buildSuggestTestsReport({
    changed: ['src/lib.js'],
    graphRelations: boundedGraph,
    tests: ['tests/a.test.js', 'tests/b.test.js', 'tests/c.test.js'],
    caps: { maxSuggestions: 1 },
    indexCompatKey: 'compat-suggest-tests-bounded',
    now: () => '2026-01-01T00:00:00.000Z'
  });

  assert.strictEqual(report.suggestions.length, 1);
  assert.equal(report.fidelity?.source, 'graph');
  assert.equal(report.fidelity?.state, 'complete');
  assert(Array.isArray(report.truncation) && report.truncation.some((entry) => entry.cap === 'maxSuggestions'));
}

console.log('suggest-tests contract matrix test passed');
