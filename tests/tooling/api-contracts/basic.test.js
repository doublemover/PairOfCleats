#!/usr/bin/env node
import assert from 'node:assert';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';

const symbols = [
  {
    symbolId: 'sym-1',
    chunkUid: 'chunk-1',
    file: 'src/example.js',
    name: 'doThing',
    kind: 'Function',
    signature: 'doThing(a, b)'
  }
];

const callSites = [
  {
    callSiteId: 'call-1',
    targetChunkUid: 'chunk-1',
    file: 'src/caller.js',
    startLine: 10,
    args: ['1', '2']
  }
];

const report = buildApiContractsReport({
  symbols,
  callSites,
  caps: { maxSymbols: 10, maxCallsPerSymbol: 5, maxWarnings: 10 },
  indexCompatKey: 'compat-api-contracts-basic'
});

assert.strictEqual(report.symbols.length, 1, 'expected one symbol entry');
assert.strictEqual(report.symbols[0].observedCalls.length, 1, 'expected one observed call');

console.log('api contracts basic test passed');
