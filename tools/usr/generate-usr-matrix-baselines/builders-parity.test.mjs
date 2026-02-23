#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureTestingEnv } from '../../../tests/helpers/test-env.js';
import {
  assertLanguageFrameworkApplicability,
  buildRegistryRecords,
  normalizeLanguageBaselines
} from './builders.mjs';

ensureTestingEnv(process.env);

assert.doesNotThrow(
  () => assertLanguageFrameworkApplicability(),
  'language/framework applicability mappings must remain bidirectionally consistent'
);

const expectedRegistryOrder = [
  'usr-language-profiles',
  'usr-language-version-policy',
  'usr-language-embedding-policy',
  'usr-framework-profiles',
  'usr-node-kind-mapping',
  'usr-edge-kind-constraints',
  'usr-capability-matrix',
  'usr-conformance-levels',
  'usr-backcompat-matrix',
  'usr-framework-edge-cases',
  'usr-language-risk-profiles',
  'usr-embedding-bridge-cases',
  'usr-generated-provenance-cases',
  'usr-parser-runtime-lock',
  'usr-slo-budgets',
  'usr-alert-policies',
  'usr-redaction-rules',
  'usr-security-gates',
  'usr-runtime-config-policy',
  'usr-failure-injection-matrix',
  'usr-fixture-governance',
  'usr-benchmark-policy',
  'usr-threat-model-matrix',
  'usr-waiver-policy',
  'usr-quality-gates',
  'usr-operational-readiness-policy',
  'usr-ownership-matrix',
  'usr-escalation-policy'
];

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');

const firstPass = buildRegistryRecords(normalizeLanguageBaselines(), matrixDir);
const secondPass = buildRegistryRecords(normalizeLanguageBaselines(), matrixDir);

assert.deepEqual(
  firstPass.map((record) => record.registryId),
  expectedRegistryOrder,
  'registry emission order is a contractual append-only sequence'
);

assert.deepEqual(
  secondPass.map((record) => record.serialized),
  firstPass.map((record) => record.serialized),
  'registry serialization must be deterministic across repeated runs'
);

for (const record of firstPass) {
  const persisted = fs.readFileSync(record.filePath, 'utf8');
  assert.equal(
    record.serialized,
    persisted,
    `expected generated payload parity with ${record.registryId}.json`
  );
}

console.log('builder parity tests passed');
