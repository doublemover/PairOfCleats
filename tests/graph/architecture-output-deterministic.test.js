#!/usr/bin/env node
import assert from 'node:assert';
import { renderArchitectureReport } from '../../src/retrieval/output/architecture.js';

const report = {
  rules: [
    { id: 'rule-b', type: 'deny', summary: { violations: 2 } },
    { id: 'rule-a', type: 'allow', summary: { violations: 1 } }
  ],
  violations: [
    { ruleId: 'rule-b', edge: { edgeType: 'import', from: { type: 'file', path: 'b.js' }, to: { type: 'file', path: 'c.js' } } },
    { ruleId: 'rule-a', edge: { edgeType: 'call', from: { type: 'file', path: 'a.js' }, to: { type: 'file', path: 'b.js' } } }
  ],
  truncation: [{ cap: 'maxViolations', limit: 1, observed: 2, omitted: 1 }],
  warnings: [{ code: 'ARCH_WARN', message: 'arch warning' }]
};

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

console.log('architecture output determinism test passed');
