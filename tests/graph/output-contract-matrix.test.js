#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildSuggestTestsReport } from '../../src/graph/suggest-tests.js';
import { renderGraphImpact } from '../../src/retrieval/output/graph-impact.js';
import { renderSuggestTestsReport } from '../../src/retrieval/output/suggest-tests.js';

{
  const payload = {
    seed: { type: 'chunk', chunkUid: 'seed' },
    direction: 'downstream',
    depth: 2,
    impacted: [
      { ref: { type: 'chunk', chunkUid: 'b' }, distance: 2 },
      { ref: { type: 'chunk', chunkUid: 'a' }, distance: 1 }
    ],
    truncation: [{ cap: 'maxEdges', limit: 1, observed: 2, omitted: 1 }],
    warnings: [{ code: 'WARN', message: 'example warning' }]
  };

  const output = renderGraphImpact(payload).split('\n');
  const lineA = output.findIndex((line) => line.includes('chunk:a'));
  const lineB = output.findIndex((line) => line.includes('chunk:b'));
  assert(lineA !== -1 && lineB !== -1);
  assert(lineA < lineB);
  assert(output.includes('Truncation:'));
  assert(output.includes('Warnings:'));
}

{
  const report = {
    fidelity: {
      schemaVersion: 1,
      source: 'heuristic',
      state: 'fallback',
      reasonCodes: ['graph_missing', 'candidate_truncated'],
      graph: {
        available: false,
        used: false,
        matchedSuggestions: 0,
        visitedNodes: 0,
        edgesVisited: 0,
        workUnits: 0,
        traversalCapsHit: [],
        candidateTruncated: true
      },
      heuristic: {
        used: true
      }
    },
    suggestions: [
      {
        testPath: 'tests/b.test.js',
        score: 0.2,
        reason: 'b',
        witnessPath: { nodes: [{ path: 'b.js' }] },
        fidelity: { source: 'heuristic', state: 'fallback', reasonCodes: ['graph_missing'], matchKind: 'name', graphDistance: null }
      },
      {
        testPath: 'tests/a.test.js',
        score: 0.9,
        reason: 'a',
        witnessPath: { nodes: [{ path: 'a.js' }] },
        fidelity: { source: 'heuristic', state: 'fallback', reasonCodes: ['graph_missing'], matchKind: 'name', graphDistance: null }
      }
    ],
    truncation: [{ cap: 'maxSuggestions', limit: 1, observed: 2, omitted: 1 }],
    warnings: [{ code: 'SUGGEST_WARN', message: 'suggest warning' }]
  };

  const output = renderSuggestTestsReport(report).split('\n');
  const firstSuggestion = output.findIndex((line) => line.includes('tests/a.test.js'));
  const secondSuggestion = output.findIndex((line) => line.includes('tests/b.test.js'));
  assert(firstSuggestion !== -1 && secondSuggestion !== -1);
  assert(firstSuggestion < secondSuggestion);
  assert(output.includes('Truncation:'));
  assert(output.includes('Warnings:'));
  assert(output.includes('Fidelity:'));
  assert(output.some((line) => line.includes('fidelity: heuristic/fallback [graph_missing]')));
  assert(output.some((line) => line.includes('reasons=graph_missing, candidate_truncated')));
}

{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'suggest-tests-cache-'));
  const srcDir = path.join(repoRoot, 'src');
  const testsDir = path.join(repoRoot, 'tests');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'app.js'), 'export const app = 1;');
  fs.writeFileSync(path.join(testsDir, 'app.test.js'), 'test("app", () => {});');

  const build = () => buildSuggestTestsReport({
    changed: ['src/app.js'],
    repoRoot,
    graphRelations: null,
    indexSignature: 'test',
    now: () => '2026-02-04T00:00:00.000Z'
  });

  const first = build();
  fs.writeFileSync(path.join(testsDir, 'other.test.js'), 'test("other", () => {});');
  const second = build();

  assert.strictEqual(first.suggestions.length, 1);
  assert.strictEqual(second.suggestions.length, 1);
  assert.strictEqual(second.suggestions[0].testPath, first.suggestions[0].testPath);
}

console.log('graph output contract matrix test passed');
