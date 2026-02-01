#!/usr/bin/env node
import assert from 'node:assert';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';

const report = buildApiContractsReport({
  symbols: [
    {
      symbolId: 'sym-1',
      chunkUid: 'chunk-1',
      file: 'src/example.js',
      name: 'doThing',
      kind: 'Function',
      signature: 'doThing(a, b)'
    }
  ],
  callSites: [],
  caps: { maxSymbols: 10, maxCallsPerSymbol: 5, maxWarnings: 10 },
  indexCompatKey: 'compat-api-contracts-schema'
});

const validation = validateApiContracts(report);
assert(validation.ok, `expected schema validation to pass: ${validation.errors.join(', ')}`);

console.log('api contracts schema validation test passed');
