import { withFixtureCallArguments } from '../../helpers/call-arguments.js';
import assert from 'node:assert/strict';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { createApiContractCallTargetIndex } from '../../../src/integrations/tooling/api-contract-targets.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';
import { renderApiContracts } from '../../../src/retrieval/output/api-contracts.js';

const symbols = [
  { symbolId: 'moduleA.foo', chunkUid: 'chunk-A', file: 'a.ts', name: 'foo', signature: 'foo(a)', exported: true, scheme: 'heur' },
  { symbolId: 'moduleB.foo', chunkUid: 'chunk-B', file: 'b.ts', name: 'foo', signature: 'foo(a,b)', exported: false, scheme: 'heur' }
];
const call = withFixtureCallArguments({ callSiteId: 'call-A', file: 'use-a.ts', callerChunkUid: 'caller-A', startLine: 1,
  targetChunkUid: 'chunk-A', calleeNormalized: 'foo', args: ['1'], confidence: 1 });
const fixed = { indexSignature: 'generation-A', indexCompatKey: 'compat', now: () => '2026-10-23T00:00:00.000Z' };
const build = input => buildApiContractsReport({ ...fixed, symbols, callSites: [call], ...input });
const report = build({ failOnWarn: true, caps: { maxWarnings: 0 } });
assert.deepEqual(report.symbols.map(entry => entry.observedCalls.length), [1, 0]);
assert.equal(report.warnings, null); assert.equal(report.truncation, null);
const observed = report.symbols[0].observedCalls[0];
assert.equal(observed.targetChunkUid, 'chunk-A'); assert.equal(observed.join.symbolId, 'moduleA.foo');
assert.equal(observed.join.indexSignature, 'generation-A'); assert.equal(observed.join.providerScheme, 'heur');
assert.equal(validateApiContracts(report).ok, true); assert.equal(validateArtifact('api_contracts', report.symbols).ok, true);
assert.match(renderApiContracts(report), /moduleA.foo \[chunk-A; recorded-target-chunk\]/);

const builder = createApiContractCallTargetIndex(); builder.add(call);
const captured = builder.finish(); assert.equal(builder.finish(), captured);
assert.throws(() => builder.add(call), /already sealed/);
assert.deepEqual(build({ callSites: [], callSitesByTarget: captured }), build({}));
const map = new Map([['not-target-authority', [{ ...call }]]]), before = structuredClone(map);
assert.deepEqual(build({ callSites: [], callSitesByTarget: map }), build({})); assert.deepEqual(map, before);
const duplicated = build({ callSites: [], callSitesByTarget: new Map([
  ['chunk-A', [call]], ['chunk-B', [{ ...call }]], ['foo', [{ ...call, indexSignature: 'generation-A' }]]
]) });
assert.deepEqual(duplicated.symbols.map(entry => entry.observedCalls.length), [1, 0]);
assert.equal(duplicated.callEvidence.duplicateCallCount, 2); assert.equal(validateApiContracts(duplicated).ok, true);

const lexical = { ...call, callSiteId: 'unresolved', targetChunkUid: null };
for (const options of [{}, { onlyExports: true }, { caps: { maxSymbols: 1 } }]) {
  const unresolved = build({ ...options, callSites: [lexical], failOnWarn: true });
  assert.ok(unresolved.symbols.every(entry => entry.observedCalls.length === 0));
  assert.equal(unresolved.callEvidence.unresolvedByReason['ambiguous-lexical'], 1);
  assert.equal(unresolved.warnings, null); assert.equal(validateApiContracts(unresolved).ok, true);
}
const unqualifiedMap = build({ callSitesByTarget: new Map([['chunk-A', [lexical]]]) });
assert.equal(unqualifiedMap.callEvidence.qualifiedCallCount, 0, 'a supplied exact-looking bucket cannot promote a lexical call');
const singleLexical = build({ symbols: [symbols[0]], callSites: [lexical] });
assert.equal(singleLexical.callEvidence.unresolvedByReason['unresolved-lexical'], 1, 'one displayed declaration is still no resolver');
const alias = build({ callSites: [{ ...call, calleeNormalized: 'importedAlias' }] });
assert.deepEqual(alias.symbols.map(entry => entry.observedCalls.length), [1, 0]);

for (const [input, reason] of [
  [{ callSites: [{ ...call, targetChunkUid: 'moduleA.foo' }] }, 'unknown-target'],
  [{ callSites: [{ ...call, targetChunkUid: [] }] }, 'invalid-target'],
  [{ callSites: [{ ...call, indexSignature: 'generation-B' }] }, 'generation-mismatch'],
  [{ symbols: [{ ...symbols[0], indexSignature: 'generation-B' }, symbols[1]] }, 'generation-mismatch'],
  [{ callSites: [{ ...call, extensions: { syntax: { resolution: 'ambiguous' } } }] }, 'ambiguous-target'],
  [{ symbols: [symbols[0], { ...symbols[1], chunkUid: 'chunk-A' }] }, 'ambiguous-target'],
  [{ symbols: [symbols[0], { ...symbols[1], symbolId: 'moduleA.foo' }] }, 'ambiguous-target'],
  [{ callSites: [call, { ...call, targetChunkUid: 'chunk-B' }] }, 'conflicting-call-identity']
]) {
  const negative = build({ ...input, failOnWarn: true });
  assert.equal(negative.callEvidence.unresolvedByReason[reason], 1, reason);
  assert.equal(negative.callEvidence.qualifiedCallCount, 0, reason);
  assert.equal(negative.warnings, null); assert.equal(validateApiContracts(negative).ok, true);
}
const overloaded = build({ symbols: [symbols[0], { ...symbols[0], symbolId: 'moduleA.foo.overload', signature: 'foo(a,b)' }] });
assert.equal(overloaded.callEvidence.unresolvedByReason['ambiguous-target'], 1);
const classes = build({ symbols: symbols.map((symbol, index) => ({ ...symbol, symbolId: `Class${index}.foo`, name: 'Class.foo' })) });
assert.deepEqual(classes.symbols.map(entry => entry.observedCalls.length), [1, 0]);

for (const maxWarnings of [0, 1]) assert.throws(() => build({ callSites: [{ ...call, targetChunkUid: 'chunk-B' }],
  failOnWarn: true, caps: { maxWarnings } }), error => {
  assert.equal(error.code, 'ERR_API_CONTRACT_WARN'); assert.equal(error.report.warnings?.length || 0, maxWarnings);
  assert.deepEqual(error.report.symbols.map(entry => entry.observedCalls.length), [0, 1]);
  assert.equal(validateApiContracts(error.report).ok, true); return true;
});
const capped = build({ callSites: [call, { ...call, callSiteId: 'later', startLine: 2 }], caps: { maxCallsPerSymbol: 1 } });
assert.equal(capped.callEvidence.qualifiedCallCount, 2); assert.equal(capped.callEvidence.reportedCallCount, 1);
assert.equal(capped.callEvidence.omittedQualifiedCallCount, 1); assert.equal(validateApiContracts(capped).ok, true);
const filtered = build({ onlyExports: true, callSites: [{ ...call, targetChunkUid: 'chunk-B', args: ['1','2'] }] });
assert.equal(filtered.callEvidence.omittedQualifiedCallCount, 1); assert.equal(filtered.symbols[0].observedCalls.length, 0);
assert.equal(validateApiContracts(filtered).ok, true);

for (const mutate of [
  value => { value.symbols[0].observedCalls[0].targetChunkUid = 'chunk-B'; },
  value => { value.symbols[0].observedCalls[0].join.symbolId = 'moduleB.foo'; },
  value => { value.symbols[0].observedCalls[0].join.indexSignature = 'generation-B'; },
  value => { value.symbols[0].observedCalls[0].join.extra = true; },
  value => { delete value.symbols[0].observedCalls[0].join; },
  value => { value.callEvidence.unresolvedCallCount = 1; },
  value => { value.symbols[0].observedCalls.push(structuredClone(value.symbols[0].observedCalls[0])); }
]) {
  const invalid = structuredClone(report); mutate(invalid); assert.equal(validateApiContracts(invalid).ok, false);
}
const invalidArtifact = structuredClone(report.symbols); invalidArtifact[0].observedCalls[0].join.targetChunkUid = 'chunk-B';
assert.equal(validateArtifact('api_contracts', invalidArtifact).ok, false);
const mutable = build({ callSitesByTarget: captured }); mutable.symbols[0].observedCalls[0].args[0] = 'changed';
assert.deepEqual(build({ callSitesByTarget: captured }), build({}), 'rendered output cannot mutate a private captured call index');
const metrics = {}, many = Array.from({ length: 512 }, (_, index) => ({ ...call, callSiteId: `call-${index}` }));
const repeated = build({ callSites: many, metrics });
assert.equal(metrics.apiContractSymbolRows, 2); assert.equal(metrics.apiContractCallRows, many.length);
assert.equal(metrics.apiContractTargetLookups, many.length); assert.equal(repeated.callEvidence.qualifiedCallCount, many.length);
assert.deepEqual(repeated, build({ callSites: many }));
console.log('API contracts join only recorded targets against the complete admitted identity inventory.');
