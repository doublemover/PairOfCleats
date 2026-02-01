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
    to: { anyOf: ['src/core/**'] },
    severity: 'error'
  }
];

const report = buildArchitectureReport({
  rules,
  graphRelations,
  indexCompatKey: 'compat-architecture-import',
  now: () => '2026-01-01T00:00:00.000Z'
});

assert.strictEqual(report.violations.length, 1, 'expected a single import violation');
assert.strictEqual(report.violations[0].edge.edgeType, 'import');
assert.strictEqual(report.violations[0].ruleId, 'no-app-import-core');

console.log('architecture forbidden import test passed');
