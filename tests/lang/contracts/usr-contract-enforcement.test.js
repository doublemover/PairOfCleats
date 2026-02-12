#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';
import { validateUsrMatrixRegistry, listUsrMatrixRegistryIds } from '../../../src/contracts/validators/usr-matrix.js';
import { validateUsrReport } from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const matrixDir = path.join(repoRoot, 'tests', 'lang', 'matrix');
const languageSpecDir = path.join(repoRoot, 'docs', 'specs', 'usr', 'languages');

const loadRegistry = (registryId) => {
  const filePath = path.join(matrixDir, `${registryId}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

const assertSameSet = (label, left, right) => {
  const a = [...left].sort();
  const b = [...right].sort();
  assert.deepEqual(a, b, `${label} mismatch\nleft=${JSON.stringify(a)}\nright=${JSON.stringify(b)}`);
};

const languageProfiles = loadRegistry('usr-language-profiles');
const frameworkProfiles = loadRegistry('usr-framework-profiles');
const languageVersionPolicy = loadRegistry('usr-language-version-policy');
const languageEmbeddingPolicy = loadRegistry('usr-language-embedding-policy');
const runtimeConfigPolicy = loadRegistry('usr-runtime-config-policy');
const failureInjectionMatrix = loadRegistry('usr-failure-injection-matrix');
const fixtureGovernance = loadRegistry('usr-fixture-governance');
const benchmarkPolicy = loadRegistry('usr-benchmark-policy');
const sloBudgets = loadRegistry('usr-slo-budgets');
const threatModel = loadRegistry('usr-threat-model-matrix');
const securityGates = loadRegistry('usr-security-gates');
const redactionRules = loadRegistry('usr-redaction-rules');
const alertPolicies = loadRegistry('usr-alert-policies');
const waiverPolicy = loadRegistry('usr-waiver-policy');
const ownershipMatrix = loadRegistry('usr-ownership-matrix');
const escalationPolicy = loadRegistry('usr-escalation-policy');
const nodeKindMapping = loadRegistry('usr-node-kind-mapping');
const parserRuntimeLock = loadRegistry('usr-parser-runtime-lock');

// Drift checks: language ID sets.
const registryLanguageIds = new Set(LANGUAGE_REGISTRY.map((entry) => entry.id));
const profileLanguageIds = new Set(languageProfiles.rows.map((row) => row.id));
const versionLanguageIds = new Set(languageVersionPolicy.rows.map((row) => row.languageId));
const embeddingLanguageIds = new Set(languageEmbeddingPolicy.rows.map((row) => row.languageId));

assertSameSet('language-registry vs usr-language-profiles', registryLanguageIds, profileLanguageIds);
assertSameSet('usr-language-profiles vs usr-language-version-policy', profileLanguageIds, versionLanguageIds);
assertSameSet('usr-language-profiles vs usr-language-embedding-policy', profileLanguageIds, embeddingLanguageIds);

// Bidirectional framework applicability integrity.
const frameworkIds = new Set(frameworkProfiles.rows.map((row) => row.id));
const profileFrameworkMap = new Map(languageProfiles.rows.map((row) => [row.id, new Set(row.frameworkProfiles || [])]));
for (const row of languageProfiles.rows) {
  for (const frameworkId of row.frameworkProfiles || []) {
    assert.equal(frameworkIds.has(frameworkId), true, `unknown framework reference on language profile: ${row.id} -> ${frameworkId}`);
  }
}
for (const frameworkRow of frameworkProfiles.rows) {
  for (const languageId of frameworkRow.appliesToLanguages || []) {
    const languageSet = profileFrameworkMap.get(languageId);
    assert.equal(Boolean(languageSet), true, `framework appliesToLanguages references unknown language: ${frameworkRow.id} -> ${languageId}`);
    assert.equal(languageSet.has(frameworkRow.id), true, `framework->language mapping missing inverse language->framework mapping: ${frameworkRow.id} -> ${languageId}`);
  }
}

// Parser/runtime lock coverage for all parser sources used by language fallback chains.
const requiredParserSources = new Set();
for (const row of languageProfiles.rows) {
  for (const parserSource of row.fallbackChain || []) requiredParserSources.add(parserSource);
}
const lockedParserSources = new Set(parserRuntimeLock.rows.map((row) => row.parserSource));
for (const parserSource of requiredParserSources) {
  assert.equal(lockedParserSources.has(parserSource), true, `missing parser lock coverage: ${parserSource}`);
}

// Deterministic normalization mapping checks.
const mappingKey = (row) => `${row.languageId}|${row.parserSource}|${row.rawKind}|${row.priority}`;
const mappingKeys = new Set();
for (const row of nodeKindMapping.rows) {
  const key = mappingKey(row);
  assert.equal(mappingKeys.has(key), false, `duplicate node-kind mapping key: ${key}`);
  mappingKeys.add(key);
}

// Strict matrix schema checks for all implemented registry schemas.
for (const registryId of listUsrMatrixRegistryIds()) {
  const payload = loadRegistry(registryId);
  const result = validateUsrMatrixRegistry(registryId, payload);
  assert.equal(result.ok, true, `${registryId} should validate: ${result.errors.join('; ')}`);
}

const strictNegativePayload = {
  ...runtimeConfigPolicy,
  rows: runtimeConfigPolicy.rows.map((row, idx) => (idx === 0 ? { ...row, unknownFlag: true } : row))
};
const strictNegativeResult = validateUsrMatrixRegistry('usr-runtime-config-policy', strictNegativePayload);
assert.equal(strictNegativeResult.ok, false, 'runtime-config-policy should reject unknown row keys');

// Failure injection completeness checks.
const requiredFaultClasses = new Set([
  'mapping-conflict',
  'parser-timeout',
  'parser-unavailable',
  'redaction-failure',
  'resource-budget-breach',
  'resolution-ambiguity-overflow',
  'security-gate-failure',
  'serialization-corruption'
]);
const presentFaultClasses = new Set(failureInjectionMatrix.rows.map((row) => row.faultClass));
assertSameSet('failure-injection fault classes', requiredFaultClasses, presentFaultClasses);

// Fixture governance integrity.
const fixtureIds = new Set();
for (const row of fixtureGovernance.rows) {
  assert.equal(fixtureIds.has(row.fixtureId), false, `duplicate fixtureId: ${row.fixtureId}`);
  fixtureIds.add(row.fixtureId);
  assert.equal(typeof row.owner === 'string' && row.owner.length > 0, true, `fixture owner missing: ${row.fixtureId}`);
  assert.equal(Array.isArray(row.reviewers) && row.reviewers.length > 0, true, `fixture reviewers missing: ${row.fixtureId}`);
  assert.equal(['require-rfc', 'require-review', 'allow-generated-refresh'].includes(row.mutationPolicy), true, `fixture mutationPolicy invalid: ${row.fixtureId}`);
}

// Security/SLO plumbing coverage.
const budgetLaneIds = new Set(sloBudgets.rows.map((row) => row.laneId));
for (const row of benchmarkPolicy.rows) {
  assert.equal(budgetLaneIds.has(row.laneId), true, `benchmark lane missing SLO budget: ${row.id} -> ${row.laneId}`);
}

const controlIds = new Set([
  ...securityGates.rows.map((row) => row.id),
  ...redactionRules.rows.map((row) => row.id),
  ...alertPolicies.rows.map((row) => row.id)
]);
for (const row of threatModel.rows) {
  for (const controlId of row.requiredControls || []) {
    assert.equal(controlIds.has(controlId), true, `threat references unknown control: ${row.id} -> ${controlId}`);
  }
  for (const fixtureId of row.requiredFixtures || []) {
    assert.equal(fixtureIds.has(fixtureId), true, `threat references unknown fixture: ${row.id} -> ${fixtureId}`);
  }
}

// Waiver policy and ownership/escalation integrity.
for (const row of waiverPolicy.rows) {
  assert.equal(typeof row.allowedUntil === 'string' && row.allowedUntil.includes('T'), true, `waiver allowedUntil must be ISO timestamp: ${row.id}`);
  assert.equal(Array.isArray(row.approvers) && row.approvers.length > 0, true, `waiver approvers required: ${row.id}`);
}

const escalationIds = new Set(escalationPolicy.rows.map((row) => row.id));
for (const row of ownershipMatrix.rows) {
  assert.equal(escalationIds.has(row.escalationPolicyId), true, `ownership row references unknown escalation policy: ${row.id}`);
}

// Per-language contract file existence.
for (const languageId of profileLanguageIds) {
  const filePath = path.join(languageSpecDir, `${languageId}.md`);
  assert.equal(fs.existsSync(filePath), true, `missing per-language contract file: docs/specs/usr/languages/${languageId}.md`);
}

// Harness core report schema check for section 30 envelope + report fields.
const harnessReport = {
  schemaVersion: 'usr-1.0.0',
  artifactId: 'usr-validation-report',
  generatedAt: '2026-02-12T00:00:00Z',
  producerId: 'usr-contract-enforcement-test',
  runId: 'run-contract-enforcement-001',
  lane: 'ci',
  buildId: null,
  status: 'pass',
  scope: { scopeType: 'lane', scopeId: 'ci' },
  summary: { checks: 1, failures: 0 },
  rows: []
};
const harnessReportResult = validateUsrReport('usr-validation-report', harnessReport);
assert.equal(harnessReportResult.ok, true, `harness report must validate: ${harnessReportResult.errors.join('; ')}`);

// Generator idempotence: regeneration must not add matrix drift relative to pre-run state.
const diffBefore = execFileSync('git', ['diff', '--name-only', '--', 'tests/lang/matrix'], {
  cwd: repoRoot,
  encoding: 'utf8'
}).trim();
execFileSync('node', ['tools/usr/generate-usr-matrix-baselines.mjs'], { cwd: repoRoot, stdio: 'pipe' });
const diffAfter = execFileSync('git', ['diff', '--name-only', '--', 'tests/lang/matrix'], {
  cwd: repoRoot,
  encoding: 'utf8'
}).trim();
assert.equal(diffAfter, diffBefore, `matrix generator must be idempotent; drift delta detected:\nbefore=${diffBefore || '<clean>'}\nafter=${diffAfter || '<clean>'}`);

console.log('usr contract enforcement checks passed');
