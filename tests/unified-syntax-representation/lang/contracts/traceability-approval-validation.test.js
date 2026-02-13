#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const roadmapPath = path.join(repoRoot, 'TES_LAYN_ROADMAP.md');
const coverageMatrixPath = path.join(repoRoot, 'docs', 'specs', 'usr-consolidation-coverage-matrix.md');

const roadmapText = fs.readFileSync(roadmapPath, 'utf8');
const coverageMatrixText = fs.readFileSync(coverageMatrixPath, 'utf8');

assert.equal(roadmapText.includes('- [x] USR traceability matrix drafted and approved.'), true, 'phase 0.3 must mark traceability matrix approval complete');
assert.equal(roadmapText.includes('### N.7 Traceability approval lock'), true, 'roadmap must define appendix N.7 traceability approval lock policy');

const statusMatch = coverageMatrixText.match(/^Status:\s+(.+)$/m);
assert.notEqual(statusMatch, null, 'coverage matrix must declare status line');
assert.equal(/^Approved\b/.test(statusMatch[1]), true, 'coverage matrix status must be Approved for phase 0.3 closure');

assert.equal(coverageMatrixText.includes('## Approval lock'), true, 'coverage matrix must include approval lock section');
assert.equal(/Approval record ID:\s+`usr-traceability-approval-\d{4}-\d{2}-\d{2}`/.test(coverageMatrixText), true, 'approval lock must declare canonical approval record ID');
assert.equal(/Approved at:\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/.test(coverageMatrixText), true, 'approval lock must declare ISO 8601 approval timestamp');

const requiredRoleRows = [
  '| `usr-architecture` | approved |',
  '| `usr-conformance` | approved |',
  '| `usr-operations` | approved |'
];

for (const roleRow of requiredRoleRows) {
  assert.equal(coverageMatrixText.includes(roleRow), true, `approval lock missing required role decision row: ${roleRow}`);
}

assert.equal(coverageMatrixText.includes('USR sections 5 through 36'), true, 'approval scope must explicitly cover USR sections 5 through 36');

console.log('usr traceability approval validation checks passed');
