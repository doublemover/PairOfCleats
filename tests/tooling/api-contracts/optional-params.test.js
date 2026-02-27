#!/usr/bin/env node
import assert from 'node:assert';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';

const symbols = [
  {
    symbolId: 'sym-optional',
    chunkUid: 'chunk-optional',
    file: 'src/example.js',
    name: 'doThing',
    kind: 'Function',
    signature: 'doThing(a, b=1, c?)'
  },
  {
    symbolId: 'sym-rest',
    chunkUid: 'chunk-rest',
    file: 'src/example.js',
    name: 'log',
    kind: 'Function',
    signature: 'log(a, ...rest)'
  }
];

const callSites = [
  {
    callSiteId: 'call-optional',
    targetChunkUid: 'chunk-optional',
    file: 'src/caller.js',
    startLine: 10,
    args: ['1']
  },
  {
    callSiteId: 'call-rest',
    targetChunkUid: 'chunk-rest',
    file: 'src/caller.js',
    startLine: 20,
    args: ['1', '2', '3']
  }
];

const report = buildApiContractsReport({
  symbols,
  callSites,
  caps: { maxSymbols: 10, maxCallsPerSymbol: 5, maxWarnings: 10 },
  indexCompatKey: 'compat-api-contracts-optional'
});

assert.strictEqual(report.warnings, null, 'expected no arity warnings for optional/rest params');

console.log('api contracts optional params test passed');
