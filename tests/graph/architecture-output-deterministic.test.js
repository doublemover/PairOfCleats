#!/usr/bin/env node
import { buildArchitectureReport } from '../../src/graph/architecture.js';
import assert from 'node:assert';
import { renderArchitectureReport } from '../../src/retrieval/output/architecture.js';

const report = buildArchitectureReport({
  indexSignature: 'architecture-render-fixture', caps: { maxViolations: 2 },
  rules: [
    { id: 'rule-b', type: 'forbiddenImport', from: { anyOf: ['b.js'] }, to: { anyOf: ['c.js'] } },
    { id: 'rule-a', type: 'forbiddenCall', from: { anyOf: ['a.js'] }, to: { anyOf: ['b.js'] } }
  ],
  graphRelations: {
    callGraph: { nodes: [{ id: 'chunk-a', file: 'a.js', name: 'caller', out: ['chunk-b'] },
      { id: 'chunk-b', file: 'b.js', name: 'callee', out: [] }] },
    importGraph: { nodes: [{ id: 'b.js', out: ['c.js', 'c.js'] }, { id: 'c.js', out: [] }] }
  }
});
assert.throws(() => renderArchitectureReport({ ...report, version: '1.0.0' }),
  error => error.code === 'ERR_ARCHITECTURE_REPORT_VERSION');

const output = renderArchitectureReport(report).split('\n');
const ruleA = output.findIndex((line) => line.startsWith('- rule-a'));
const ruleB = output.findIndex((line) => line.startsWith('- rule-b'));
assert(ruleA !== -1 && ruleB !== -1, 'expected rule lines');
assert(ruleA < ruleB, 'expected rules sorted by id');
const violationA = output.findIndex((line) => line.includes('rule-a: call'));
const violationB = output.findIndex((line) => line.includes('rule-b: import'));
assert(violationA !== -1 && violationB !== -1, 'expected violation lines');
assert(violationA < violationB, 'expected violations sorted');
assert(output.includes('Truncation:'), 'expected truncation section');
assert(output.includes('Warnings:'), 'expected warnings section');
assert(output.some(line => line.includes('a.js (caller)') && line.includes('b.js (callee)')), 'known paths and labels remain actionable');
assert(output.some(line => line.startsWith('Policy: sha256:')), 'the rendered report identifies its admitted policy');

console.log('architecture output determinism test passed');
