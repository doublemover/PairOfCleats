import assert from 'node:assert/strict';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { renderApiContracts } from '../../../src/retrieval/output/api-contracts.js';
import { projectApiContractDiagnostics } from '../../../src/retrieval/output/api-contract-diagnostics.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { emitReportOutcome } from '../../../src/integrations/tooling/report-outcome.js';

const symbol = { symbolId: 'sym-api', chunkUid: 'chunk-api', file: 'api.js', name: 'doThing',
  signature: 'doThing(a, b)', kind: 'Function', exported: true, scheme: 'heur' };
const calls = Array.from({ length: 4 }, (_, index) => ({ callSiteId: `call-${index + 1}`, targetChunkUid: 'chunk-api',
  callerChunkUid: 'caller', file: 'caller.js', startLine: (index + 1) * 10, startCol: 7,
  calleeNormalized: 'doThing', args: index === 3 ? ['1'] : ['1', '2'] }));
const build = input => buildApiContractsReport({ symbols: [symbol], callSites: calls, indexSignature: 'generation-actionable',
  indexCompatKey: 'compat-actionable', now: () => '2026-10-23T00:00:00.000Z', ...input });
const report = build({});
assert.equal(validateApiContracts(report).ok, true);
const rendered = renderApiContracts(report);
assert.match(rendered, /\[ARITY_MISMATCH\].*Observed arity 1.*Expected 2/);
assert.match(rendered, /call call-4; caller\.js:40:7/);
assert.match(rendered, /join recorded-target-chunk; generation generation-actionable/);
assert.match(rendered, /1 retained call\(s\) omitted from this preview/);
assert.equal(projectApiContractDiagnostics(report).total, 1, 'global and per-symbol copies count once');
const reordered = structuredClone(report);
reordered.symbols[0].warnings[0].data = Object.fromEntries(Object.entries(reordered.symbols[0].warnings[0].data).reverse());
assert.equal(projectApiContractDiagnostics(reordered).total, 1, 'diagnostic identity is independent of data key order');
const legacy = { ...symbol }; delete legacy.exported;
const unknownExport = build({ symbols: [legacy], onlyExports: true });
assert.equal(unknownExport.symbols.length, 0);
assert.match(renderApiContracts(unknownExport), /EXPORT_IDENTITY_UNAVAILABLE.*export-only validation is incomplete/);
assert.match(renderApiContracts(unknownExport), /symbol sym-api/);
const missingCoordinates = build({ callSites: [{ ...calls[3], startLine: null, startCol: null }] });
assert.match(renderApiContracts(missingCoordinates), /caller\.js \(line unavailable; column unavailable\)/);
const mismatch = structuredClone(report);
for (const warning of [...mismatch.warnings, ...mismatch.symbols[0].warnings]) warning.data.indexSignature = 'other-generation';
const diagnostic = projectApiContractDiagnostics(mismatch).details[0];
assert.match(diagnostic.location, /line unavailable/);
assert.equal(diagnostic.qualification, 'unavailable', 'foreign generation cannot borrow current call coordinates or qualification');
const many = build({ callSites: Array.from({ length: 150 }, (_, index) => ({ ...calls[3], callSiteId: `many-${index}`, startLine: index + 1 })) });
const limited = projectApiContractDiagnostics(many);
assert.equal(limited.total, 150); assert.equal(limited.details.length, 100); assert.equal(limited.omitted, 50);
assert.match(renderApiContracts(many), /omitted from human output: 50/);
const clean = build({ callSites: calls.slice(0, 3) });
assert.equal(projectApiContractDiagnostics(clean).total, 0);

let policyFailure;
try { build({ failOnWarn: true }); } catch (error) { policyFailure = error; }
Object.freeze(policyFailure);
const emissions = [], artifacts = [];
await assert.rejects(emitReportOutcome({ build: () => { throw policyFailure; }, validate: validateApiContracts,
  policyCodes: ['ERR_API_CONTRACT_WARN'], emit: payload => emissions.push(JSON.parse(JSON.stringify(payload))),
  emitArtifact: payload => artifacts.push(payload) }), error => error === policyFailure);
assert.equal(emissions.length, 1); assert.equal(artifacts.length, 1);
assert.equal(validateApiContracts(emissions[0]).ok, true);
assert.equal(emissions[0].warnings[0].data.callSiteId, 'call-4');
await assert.rejects(emitReportOutcome({ build: () => ({ version: 'broken' }), validate: validateApiContracts,
  emit: () => assert.fail('schema failures cannot emit analyzed success'),
  emitArtifact: () => assert.fail('schema failures cannot publish artifacts') }), error => error.code === 'ERR_REPORT_SCHEMA');
for (const failure of [null, undefined, Object.freeze(new Error('ordinary internal failure'))]) {
  await assert.rejects(emitReportOutcome({ build: () => { throw failure; }, validate: validateApiContracts,
    policyCodes: ['ERR_API_CONTRACT_WARN'], emit: () => assert.fail('ordinary failure cannot emit a policy report') }), error => error === failure);
}
console.log('API contract actionable diagnostic and outcome test passed');
