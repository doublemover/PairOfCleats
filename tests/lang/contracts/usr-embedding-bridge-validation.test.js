#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  validateUsrEdgeEndpoint,
  validateUsrReasonCode
} from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const bundlePath = path.join(repoRoot, 'tests', 'fixtures', 'usr', 'embedding-bridges', 'usr-embedding-bridge-bundle.json');
const bridgeCasesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-embedding-bridge-cases.json');
const languageEmbeddingPolicyPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-embedding-policy.json');
const edgeConstraintsPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-edge-kind-constraints.json');

const rawBundle = fs.readFileSync(bundlePath, 'utf8');
assert.equal(rawBundle.includes('//'), false, 'embedding bridge bundle must not include comments');
assert.equal(rawBundle.includes('/*'), false, 'embedding bridge bundle must not include block comments');

const bundle = JSON.parse(rawBundle);
const bridgeCases = JSON.parse(fs.readFileSync(bridgeCasesPath, 'utf8'));
const embeddingPolicy = JSON.parse(fs.readFileSync(languageEmbeddingPolicyPath, 'utf8'));
const edgeConstraints = JSON.parse(fs.readFileSync(edgeConstraintsPath, 'utf8'));

assert.equal(bundle.schemaVersion, 'usr-1.0.0', 'embedding bridge bundle schemaVersion must be usr-1.0.0');
assert.equal(bundle.fixtureId, 'usr-embedding-bridge-bundle-v1', 'unexpected embedding bridge fixture id');

const bridgeCaseRows = Array.isArray(bridgeCases.rows) ? bridgeCases.rows : [];
const bridgeCaseById = new Map(bridgeCaseRows.map((row) => [row.id, row]));
const policyByLanguageId = new Map((embeddingPolicy.rows || []).map((row) => [row.languageId, row]));

const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
const expectedBridgeCaseIds = bridgeCaseRows.map((row) => row.id).sort();
const actualBridgeCaseIds = rows.map((row) => row.bridgeCaseId).sort();
assert.deepEqual(actualBridgeCaseIds, expectedBridgeCaseIds, 'embedding bridge bundle must include all and only matrix bridge-case IDs');

const diagnosticCodeRegex = /^USR-[EWI]-[A-Z0-9-]+$/;

for (const row of rows) {
  const bridgeCaseId = row.bridgeCaseId;
  const matrixRow = bridgeCaseById.get(bridgeCaseId);
  assert.equal(Boolean(matrixRow), true, `unknown bridgeCaseId in fixture: ${bridgeCaseId}`);

  assert.equal(row.containerKind, matrixRow.containerKind, `containerKind mismatch for ${bridgeCaseId}`);
  assert.equal(row.sourceLanguageId, matrixRow.sourceLanguageId, `sourceLanguageId mismatch for ${bridgeCaseId}`);
  assert.equal(row.targetLanguageId, matrixRow.targetLanguageId, `targetLanguageId mismatch for ${bridgeCaseId}`);

  const metadata = row.bridgeMetadata || {};
  assert.equal(metadata.bridgeId, bridgeCaseId, `bridgeMetadata.bridgeId mismatch for ${bridgeCaseId}`);
  assert.equal(metadata.embeddedLanguageId, row.targetLanguageId, `bridgeMetadata.embeddedLanguageId mismatch for ${bridgeCaseId}`);

  for (const field of ['containerLanguageId', 'bridgeId', 'embeddedLanguageId']) {
    const value = metadata[field];
    assert.equal(typeof value === 'string' && value.trim().length > 0, true, `${bridgeCaseId} must include non-empty bridgeMetadata.${field}`);
  }
  for (const field of ['entryEdgeKinds', 'exitEdgeKinds', 'lossModes', 'fallbackReasonCodes']) {
    assert.equal(Array.isArray(metadata[field]), true, `${bridgeCaseId} must include array bridgeMetadata.${field}`);
  }

  for (const reasonCode of metadata.fallbackReasonCodes || []) {
    const reasonValidation = validateUsrReasonCode(reasonCode, { strictEnum: false });
    assert.equal(reasonValidation.ok, true, `${bridgeCaseId} fallback reason code must match grammar: ${reasonValidation.errors.join('; ')}`);
  }

  const sourcePolicy = policyByLanguageId.get(row.sourceLanguageId);
  assert.equal(Boolean(sourcePolicy), true, `embedding policy missing source language row: ${row.sourceLanguageId}`);
  assert.equal(sourcePolicy.canHostEmbedded, true, `${bridgeCaseId} source language must be marked canHostEmbedded`);
  assert.equal((sourcePolicy.embeddedLanguageAllowlist || []).includes(row.targetLanguageId), true, `${bridgeCaseId} source language allowlist must include target language`);

  const targetPolicy = policyByLanguageId.get(row.targetLanguageId);
  assert.equal(Boolean(targetPolicy), true, `embedding policy missing target language row: ${row.targetLanguageId}`);
  // Some target languages are container-specific embeddings (e.g. Razor -> C#) and may not be globally embeddable.

  const edges = Array.isArray(row.edges) ? row.edges : [];
  assert.equal(edges.length > 0, true, `bridge fixture row must include edges: ${bridgeCaseId}`);

  const seenEdgeKinds = new Set();
  for (const edge of edges) {
    const edgeValidation = validateUsrEdgeEndpoint(edge, edgeConstraints);
    assert.equal(edgeValidation.ok, true, `edge endpoint validation failed for ${bridgeCaseId}: ${edgeValidation.errors.join('; ')}`);

    seenEdgeKinds.add(edge.kind);

    const bridgeId = edge?.attrs?.bridgeId;
    assert.equal(bridgeId, bridgeCaseId, `${bridgeCaseId} edge must include attrs.bridgeId matching bridgeCaseId`);

    const bridgeConfidence = edge?.attrs?.bridgeConfidence;
    if (bridgeConfidence != null) {
      assert.equal(typeof bridgeConfidence === 'number' && Number.isFinite(bridgeConfidence), true, `${bridgeCaseId} bridgeConfidence must be numeric when present`);
      assert.equal(bridgeConfidence >= 0 && bridgeConfidence <= 1, true, `${bridgeCaseId} bridgeConfidence must be in [0, 1]`);
    }
  }

  for (const requiredEdgeKind of matrixRow.requiredEdgeKinds || []) {
    assert.equal(seenEdgeKinds.has(requiredEdgeKind), true, `${bridgeCaseId} must include required edge kind ${requiredEdgeKind}`);
    assert.equal((metadata.entryEdgeKinds || []).includes(requiredEdgeKind), true, `${bridgeCaseId} bridgeMetadata.entryEdgeKinds must include ${requiredEdgeKind}`);
  }

  const diagnostics = Array.isArray(row.diagnostics) ? row.diagnostics : [];
  const diagnosticCodes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  for (const requiredCode of matrixRow.requiredDiagnostics || []) {
    assert.equal(diagnosticCodes.has(requiredCode), true, `${bridgeCaseId} must include required diagnostic ${requiredCode}`);
  }

  for (const diagnostic of diagnostics) {
    assert.equal(typeof diagnostic.code === 'string' && diagnosticCodeRegex.test(diagnostic.code), true, `${bridgeCaseId} diagnostic code must match canonical grammar`);
    if (diagnostic.reasonCode != null) {
      const reasonValidation = validateUsrReasonCode(diagnostic.reasonCode, { strictEnum: false });
      assert.equal(reasonValidation.ok, true, `${bridgeCaseId} diagnostic reasonCode must match grammar: ${reasonValidation.errors.join('; ')}`);
    }
  }
}

const canonicalHashA = sha1(stableStringify(bundle));
const canonicalHashB = sha1(stableStringify(JSON.parse(rawBundle)));
assert.equal(canonicalHashA, canonicalHashB, 'embedding bridge fixture serialization hash must be stable across reruns');

console.log('usr embedding bridge validation checks passed');

