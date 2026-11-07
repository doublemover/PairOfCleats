#!/usr/bin/env node
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildArchitectureReport } from '../../../src/graph/architecture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, '..', '..', 'fixtures', 'tooling', 'architecture', 'graph-relations.json');
const graphRelations = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

const rules = [
  {
    id: 'no-app-import-core',
    type: 'forbiddenImport',
    from: { anyOf: ['src/app/**'] },
    to: { anyOf: ['src/core/**'] }
  }
];

const now = () => '2026-01-01T00:00:00.000Z';
const reportA = buildArchitectureReport({
  rules,
  graphRelations,
  indexCompatKey: 'compat-architecture-determinism',
  now
});
const reportB = buildArchitectureReport({
  rules,
  graphRelations,
  indexCompatKey: 'compat-architecture-determinism',
  now
});

// Execution is an invocation-owned measurement, separately asserted below.
// Every semantic/policy/source/index/count/truncation field remains exact.
const { execution: coldExecution, ...coldContent } = reportA;
const { execution: warmExecution, ...warmContent } = reportB;
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

console.log('architecture determinism test passed');
