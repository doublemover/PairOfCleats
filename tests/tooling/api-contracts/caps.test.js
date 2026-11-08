#!/usr/bin/env node
import assert from 'node:assert';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { renderApiContracts } from '../../../src/retrieval/output/api-contracts.js';

const symbols = [
  { symbolId: 'sym-1', chunkUid: 'chunk-1', file: 'a.js', name: 'a', kind: 'Function', signature: 'a()' },
  { symbolId: 'sym-2', chunkUid: 'chunk-2', file: 'b.js', name: 'b', kind: 'Function', signature: 'b()' }
];

const report = buildApiContractsReport({
  symbols,
  callSites: [],
  caps: { maxSymbols: 1, maxCallsPerSymbol: 1, maxWarnings: 1 },
  indexCompatKey: 'compat-api-contracts-caps'
});

assert.strictEqual(report.symbols.length, 1, 'expected maxSymbols cap to apply');
assert(report.truncation?.some((entry) => entry.cap === 'maxSymbols'), 'expected truncation for maxSymbols');

const cleanZeroCap = buildApiContractsReport({ symbols, callSites: [], caps: { maxWarnings: 0 },
  indexCompatKey: 'compat-api-contracts-clean-zero-cap' });
assert.strictEqual(cleanZeroCap.warnings, null);
assert.strictEqual(cleanZeroCap.truncation, null, 'an empty zero-cap warning list has omitted nothing');
for (const [count, limit] of [[1, 1], [3, 1], [3, 0]]) {
  const capped = buildApiContractsReport({ symbols, callSites: Array.from({ length: count }, (_, index) => ({
    callSiteId: `call-${index}`, targetChunkUid: 'chunk-1', args: ['1']
  })), caps: { maxWarnings: limit }, indexCompatKey: 'compat-api-contracts-warning-counts' });
  assert.strictEqual(capped.warnings?.length ?? 0, Math.min(count, limit));
  const omitted = capped.truncation?.find(entry => entry.cap === 'maxWarnings');
  if (count > limit) assert.deepStrictEqual(omitted,
    { scope: 'apiContracts', cap: 'maxWarnings', limit, observed: count, omitted: count - limit });
  else assert.strictEqual(omitted, undefined);
  if (count > limit) assert.match(renderApiContracts(capped),
    new RegExp(`Warnings detected: ${count}; details retained: ${limit}; omitted: ${count - limit}`));
  else assert.doesNotMatch(renderApiContracts(capped), /omitted:/);
}

const legacyCounts = renderApiContracts({ symbols: [], warnings: null, truncation: [
  { scope: 'apiContracts', cap: 'maxWarnings', limit: 0, observed: 0, omitted: null }
] });
assert.match(legacyCounts, /omission count is unreported/);
assert.doesNotMatch(legacyCounts, /Warnings detected: 0/,
  'legacy retained-only counts cannot become proof that no warnings were found');

console.log('api contracts caps test passed');
