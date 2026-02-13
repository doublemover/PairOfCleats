#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

const failureInjectionPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-failure-injection-matrix.json');
const securityGatesPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-security-gates.json');
const threatModelPath = path.join(repoRoot, 'tests', 'lang', 'matrix', 'usr-threat-model-matrix.json');

const failureInjection = JSON.parse(fs.readFileSync(failureInjectionPath, 'utf8'));
const securityGates = JSON.parse(fs.readFileSync(securityGatesPath, 'utf8'));
const threatModel = JSON.parse(fs.readFileSync(threatModelPath, 'utf8'));

const fiRows = Array.isArray(failureInjection.rows) ? failureInjection.rows : [];
const gateRows = Array.isArray(securityGates.rows) ? securityGates.rows : [];
const threatRows = Array.isArray(threatModel.rows) ? threatModel.rows : [];

const fiByFaultClass = new Map(fiRows.map((row) => [row.faultClass, row]));
const gateById = new Map(gateRows.map((row) => [row.id, row]));
const threatById = new Map(threatRows.map((row) => [row.id, row]));

const parserTimeout = fiByFaultClass.get('parser-timeout');
const parserUnavailable = fiByFaultClass.get('parser-unavailable');
assert.equal(Boolean(parserTimeout), true, 'failure-injection matrix must include parser-timeout scenario');
assert.equal(Boolean(parserUnavailable), true, 'failure-injection matrix must include parser-unavailable scenario');
assert.equal(parserTimeout.strictExpectedOutcome, 'degrade-with-diagnostics', 'parser-timeout strict outcome must preserve recovery outputs with diagnostics');
assert.equal(parserTimeout.nonStrictExpectedOutcome, 'degrade-with-diagnostics', 'parser-timeout non-strict outcome must preserve recovery outputs with diagnostics');
assert.equal(parserUnavailable.strictExpectedOutcome, 'degrade-with-diagnostics', 'parser-unavailable strict outcome must preserve degraded extraction instead of silent pass');
assert.equal((parserTimeout.requiredDiagnostics || []).includes('USR-W-CAPABILITY-DOWNGRADED'), true, 'parser-timeout scenario must emit capability downgrade diagnostics');
assert.equal((parserUnavailable.requiredDiagnostics || []).includes('USR-E-CAPABILITY-LOST'), true, 'parser-unavailable scenario must emit capability lost diagnostics');

const mappingConflict = fiByFaultClass.get('mapping-conflict');
const serializationCorruption = fiByFaultClass.get('serialization-corruption');
assert.equal(Boolean(mappingConflict), true, 'failure-injection matrix must include mapping-conflict scenario');
assert.equal(Boolean(serializationCorruption), true, 'failure-injection matrix must include serialization-corruption scenario');
assert.equal((mappingConflict.requiredDiagnostics || []).includes('USR-E-SCHEMA-VIOLATION'), true, 'mapping-conflict must emit schema-violation diagnostics');
assert.equal((serializationCorruption.requiredDiagnostics || []).includes('USR-E-SCHEMA-VIOLATION'), true, 'serialization-corruption must emit schema-violation diagnostics');

const schemaNoExtensionGate = gateById.get('security-gate-schema-no-extension');
const schemaConfusionThreat = threatById.get('threat-schema-confusion');
assert.equal(Boolean(schemaNoExtensionGate), true, 'security-gates matrix must include security-gate-schema-no-extension');
assert.equal(schemaNoExtensionGate.enforcement, 'strict', 'schema no-extension gate must be strict');
assert.equal(schemaNoExtensionGate.blocking, true, 'schema no-extension gate must be blocking');
assert.equal(Boolean(schemaConfusionThreat), true, 'threat-model matrix must include schema-confusion scenario');
assert.equal((schemaConfusionThreat.requiredControls || []).includes('security-gate-schema-no-extension'), true, 'schema-confusion threat must require security-gate-schema-no-extension');

const redactionFailure = fiByFaultClass.get('redaction-failure');
const redactionGate = gateById.get('security-gate-redaction-complete');
const sensitiveLeakageThreat = threatById.get('threat-sensitive-data-leakage');
assert.equal(Boolean(redactionFailure), true, 'failure-injection matrix must include redaction-failure scenario');
assert.equal(redactionFailure.strictExpectedOutcome, 'fail-closed', 'redaction-failure strict outcome must be fail-closed');
assert.equal(Boolean(redactionGate), true, 'security-gates matrix must include redaction completeness gate');
assert.equal(redactionGate.enforcement, 'strict', 'redaction completeness gate must be strict');
assert.equal(redactionGate.blocking, true, 'redaction completeness gate must be blocking');
assert.equal(Boolean(sensitiveLeakageThreat), true, 'threat-model matrix must include sensitive-data-leakage scenario');
assert.equal((sensitiveLeakageThreat.requiredControls || []).includes('security-gate-redaction-complete'), true, 'sensitive-data-leakage threat must require security-gate-redaction-complete');

const pathTraversalGate = gateById.get('security-gate-path-traversal');
const runtimeSandboxGate = gateById.get('security-gate-runtime-sandbox');
const pathTraversalThreat = threatById.get('threat-path-traversal');
const untrustedExecutionThreat = threatById.get('threat-untrusted-execution');
assert.equal(Boolean(pathTraversalGate), true, 'security-gates matrix must include path-traversal gate');
assert.equal(pathTraversalGate.enforcement, 'strict', 'path-traversal gate must be strict');
assert.equal(pathTraversalGate.blocking, true, 'path-traversal gate must be blocking');
assert.equal(Boolean(runtimeSandboxGate), true, 'security-gates matrix must include runtime-sandbox gate');
assert.equal(runtimeSandboxGate.enforcement, 'strict', 'runtime-sandbox gate must be strict');
assert.equal(runtimeSandboxGate.blocking, true, 'runtime-sandbox gate must be blocking');
assert.equal(Boolean(pathTraversalThreat), true, 'threat-model matrix must include path-traversal scenario');
assert.equal(pathTraversalThreat.blocking, true, 'path-traversal threat must be blocking');
assert.equal((pathTraversalThreat.requiredControls || []).includes('security-gate-path-traversal'), true, 'path-traversal threat must require path-traversal gate');
assert.equal(Boolean(untrustedExecutionThreat), true, 'threat-model matrix must include untrusted-execution scenario');
assert.equal(untrustedExecutionThreat.blocking, true, 'untrusted-execution threat must be blocking');
assert.equal((untrustedExecutionThreat.requiredControls || []).includes('security-gate-runtime-sandbox'), true, 'untrusted-execution threat must require runtime-sandbox gate');

console.log('usr failure-mode suite validation checks passed');
