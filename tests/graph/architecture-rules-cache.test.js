#!/usr/bin/env node
import assert from 'node:assert';
import { buildArchitectureReport } from '../../src/graph/architecture.js';

const rules = {
  version: 1,
  rules: [
    {
      id: 'no-b',
      type: 'forbiddenImport',
      from: { anyOf: ['src/a.js'] },
      to: { anyOf: ['src/b.js'] }
    }
  ]
};

const graphRelations = {
  version: 1,
  callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'src/a.js', out: ['src/b.js'], in: [] },
      { id: 'src/b.js', out: [], in: ['src/a.js'] }
    ]
  }
};

const build = () => buildArchitectureReport({
  rules,
  graphRelations,
  repoRoot: null,
  indexSignature: 'test',
  now: () => '2026-02-04T00:00:00.000Z'
});

const first = build();
const second = build();

// Execution is an invocation-owned measurement, separately asserted below.
// Every semantic/policy/source/index/count/truncation field remains exact.
const { execution: coldExecution, ...coldContent } = first;
const { execution: warmExecution, ...warmContent } = second;
assert.deepStrictEqual(warmContent, coldContent);
assert.strictEqual(coldExecution.work.policyCompilations, 1);
assert.strictEqual(warmExecution.work.policyCompilations, 0);
assert.strictEqual(warmExecution.work.policyCompilationHits, 1);
assert.strictEqual(coldExecution.work.graphPreparations, 1);
assert.strictEqual(warmExecution.work.graphPreparationHits, 1);
for (const execution of [coldExecution, warmExecution]) {
  for (const duration of Object.values(execution.phaseMs)) assert(Number.isFinite(duration) && duration >= 0);
  assert(Number.isFinite(execution.totalMs) && execution.totalMs >= 0);
  for (const count of Object.values(execution.work)) assert(Number.isSafeInteger(count) && count >= 0);
}
console.log('architecture rules cache test passed');
