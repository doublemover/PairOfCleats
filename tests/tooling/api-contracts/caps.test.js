#!/usr/bin/env node
import assert from 'node:assert';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';

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

console.log('api contracts caps test passed');
