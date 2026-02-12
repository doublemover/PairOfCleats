#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { sha1 } from '../../../src/shared/hash.js';
import {
  validateUsrCanonicalId,
  validateUsrDiagnosticCode,
  validateUsrReasonCode
} from '../../../src/contracts/validators/usr.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..');

const bundlePath = path.join(repoRoot, 'tests', 'fixtures', 'usr', 'generated-provenance', 'usr-generated-provenance-bundle.json');
const provenanceCasesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-generated-provenance-cases.json');
const languageProfilesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-language-profiles.json');

const rawBundle = fs.readFileSync(bundlePath, 'utf8');
assert.equal(rawBundle.includes('//'), false, 'generated provenance bundle must not include comments');
assert.equal(rawBundle.includes('/*'), false, 'generated provenance bundle must not include block comments');

const bundle = JSON.parse(rawBundle);
const provenanceCases = JSON.parse(fs.readFileSync(provenanceCasesPath, 'utf8'));
const languageProfiles = JSON.parse(fs.readFileSync(languageProfilesPath, 'utf8'));

assert.equal(bundle.schemaVersion, 'usr-1.0.0', 'generated provenance bundle schemaVersion must be usr-1.0.0');
assert.equal(bundle.fixtureId, 'usr-generated-provenance-bundle-v1', 'unexpected generated provenance fixture id');

const provenanceCaseRows = Array.isArray(provenanceCases.rows) ? provenanceCases.rows : [];
const provenanceCaseById = new Map(provenanceCaseRows.map((row) => [row.id, row]));
const languageProfileById = new Map((languageProfiles.rows || []).map((row) => [row.id, row]));

const rows = Array.isArray(bundle.rows) ? bundle.rows : [];
const expectedCaseIds = provenanceCaseRows.map((row) => row.id).sort();
const actualCaseIds = rows.map((row) => row.provenanceCaseId).sort();
assert.deepEqual(actualCaseIds, expectedCaseIds, 'generated provenance fixture must include all and only matrix provenance-case IDs');

const seenCaseIds = new Set();
for (const row of rows) {
  const caseId = row.provenanceCaseId;
  assert.equal(seenCaseIds.has(caseId), false, `duplicate provenanceCaseId in fixture: ${caseId}`);
  seenCaseIds.add(caseId);

  const matrixRow = provenanceCaseById.get(caseId);
  assert.equal(Boolean(matrixRow), true, `unknown provenanceCaseId in fixture: ${caseId}`);

  assert.equal(row.languageId, matrixRow.languageId, `languageId mismatch for ${caseId}`);
  assert.equal(row.generationKind, matrixRow.generationKind, `generationKind mismatch for ${caseId}`);
  assert.equal(row.mappingExpectation, matrixRow.mappingExpectation, `mappingExpectation mismatch for ${caseId}`);

  assert.equal(Boolean(languageProfileById.get(row.languageId)), true, `language profile missing for provenance case ${caseId}`);

  const provenanceEntries = Array.isArray(row.provenance) ? row.provenance : [];
  assert.equal(provenanceEntries.length > 0, true, `${caseId} must include at least one provenance mapping entry`);

  for (const entry of provenanceEntries) {
    const sourceDocUid = validateUsrCanonicalId('docUid', entry.sourceDocUid);
    assert.equal(sourceDocUid.ok, true, `${caseId} invalid provenance sourceDocUid: ${sourceDocUid.errors.join('; ')}`);

    const generatedDocUid = validateUsrCanonicalId('docUid', entry.generatedDocUid);
    assert.equal(generatedDocUid.ok, true, `${caseId} invalid provenance generatedDocUid: ${generatedDocUid.errors.join('; ')}`);

    const sourceNodeUid = validateUsrCanonicalId('nodeUid', entry.sourceNodeUid);
    assert.equal(sourceNodeUid.ok, true, `${caseId} invalid provenance sourceNodeUid: ${sourceNodeUid.errors.join('; ')}`);

    const generatedNodeUid = validateUsrCanonicalId('nodeUid', entry.generatedNodeUid);
    assert.equal(generatedNodeUid.ok, true, `${caseId} invalid provenance generatedNodeUid: ${generatedNodeUid.errors.join('; ')}`);

    assert.equal(typeof entry.generated === 'boolean', true, `${caseId} provenance.generated must be boolean`);

    const mappingQuality = entry.mappingQuality;
    assert.equal(['exact', 'approximate', 'missing'].includes(mappingQuality), true, `${caseId} mappingQuality must be exact|approximate|missing`);

    const confidence = entry.confidence;
    assert.equal(typeof confidence === 'number' && Number.isFinite(confidence), true, `${caseId} confidence must be numeric`);
    assert.equal(confidence >= 0 && confidence <= 1, true, `${caseId} confidence must be in [0, 1]`);

    if (row.mappingExpectation === 'exact') {
      assert.equal(mappingQuality, 'exact', `${caseId} exact expectation must use exact mappingQuality`);
      assert.equal(confidence >= 0.85, true, `${caseId} exact expectation should maintain high provenance confidence`);
    } else if (row.mappingExpectation === 'approximate') {
      assert.equal(mappingQuality !== 'exact', true, `${caseId} approximate expectation must not emit exact mappingQuality`);
      assert.equal(confidence < 0.9, true, `${caseId} approximate expectation should not claim near-exact confidence`);
    }
  }

  const diagnostics = Array.isArray(row.diagnostics) ? row.diagnostics : [];
  const diagnosticCodes = new Set(diagnostics.map((diagnostic) => diagnostic.code));

  for (const requiredCode of matrixRow.requiredDiagnostics || []) {
    assert.equal(diagnosticCodes.has(requiredCode), true, `${caseId} must include required diagnostic ${requiredCode}`);
  }

  if (row.mappingExpectation === 'exact') {
    assert.equal(diagnostics.length, 0, `${caseId} exact mappings must not emit approximation diagnostics`);
  } else {
    assert.equal(diagnostics.length > 0, true, `${caseId} approximate mappings must include diagnostics`);
  }

  for (const diagnostic of diagnostics) {
    const diagnosticValidation = validateUsrDiagnosticCode(diagnostic.code, { strictEnum: false });
    assert.equal(diagnosticValidation.ok, true, `${caseId} diagnostic code must match canonical grammar: ${diagnosticValidation.errors.join('; ')}`);

    if (diagnostic.reasonCode != null) {
      const reasonValidation = validateUsrReasonCode(diagnostic.reasonCode, { strictEnum: false });
      assert.equal(reasonValidation.ok, true, `${caseId} diagnostic reasonCode must match canonical grammar: ${reasonValidation.errors.join('; ')}`);
    }
  }
}

const canonicalHashA = sha1(stableStringify(bundle));
const canonicalHashB = sha1(stableStringify(JSON.parse(rawBundle)));
assert.equal(canonicalHashA, canonicalHashB, 'generated provenance fixture serialization hash must be stable across reruns');

console.log('usr generated provenance validation checks passed');
