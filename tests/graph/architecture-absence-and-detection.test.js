#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildArchitectureReport } from '../../src/graph/architecture.js';
import { validateArchitectureReport } from '../../src/contracts/validators/analysis.js';
import { renderArchitectureReport } from '../../src/retrieval/output/architecture.js';

const input = { rules: [{ id: 'deny-ab', type: 'forbiddenImport',
  from: { anyOf: ['src/a.js'] }, to: { anyOf: ['src/b.js'] } }],
graphRelations: { importGraph: { nodes: [{ id: 'src/a.js', out: ['src/b.js'] }, { id: 'src/b.js', out: [] }] } },
indexSignature: 'fixture' };
for (const caps of [{}, { maxViolations: undefined }, { maxViolations: null, maxEdgesExamined: null },
  { maxViolations: 10 }, { maxEdgesExamined: 10 }]) {
  const report = buildArchitectureReport({ ...input, caps });
  assert.equal(report.summary.detectedViolations, 1);
  assert.equal(report.violations.length, 1);
  assert.equal(report.summary.complete, true);
  assert.equal(validateArchitectureReport(report).ok, true);
}
const zeroDetails = buildArchitectureReport({ ...input, caps: { maxViolations: 0 } });
assert.equal(zeroDetails.violations.length, 0);
assert.equal(zeroDetails.summary.detectedViolations, 1);
assert.equal(zeroDetails.summary.omittedViolations, 1);
assert.equal(zeroDetails.rules[0].summary.violations, 1);
assert.match(renderArchitectureReport(zeroDetails), /1 detected, 0 retained, 1 omitted/);
const zeroWork = buildArchitectureReport({ ...input, caps: { maxEdgesExamined: 0 } });
assert.equal(zeroWork.summary.complete, false, 'no evaluation is an incomplete verdict, not a clean report');
assert.equal(zeroWork.summary.edgesExamined, 0);
console.log('architecture preserves omitted caps and separates detection from retained details');
