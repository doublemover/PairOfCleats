#!/usr/bin/env node
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
    args: ['1']
  }
];

try {
  buildApiContractsReport({
    symbols,
    callSites,
    failOnWarn: true,
    caps: { maxSymbols: 10, maxCallsPerSymbol: 5, maxWarnings: 10 },
    indexCompatKey: 'compat-api-contracts-fail'
  });
  console.error('expected failOnWarn to throw');
  process.exit(1);
} catch (err) {
  if (err.code !== 'ERR_API_CONTRACT_WARN') {
    console.error('unexpected error code');
    process.exit(1);
  }
}

console.log('api contracts fail-on-warn test passed');
