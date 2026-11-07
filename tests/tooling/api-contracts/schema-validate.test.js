#!/usr/bin/env node
import assert from 'node:assert';
import { withFixtureCallArguments } from '../../helpers/call-arguments.js';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';

const input = {
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
};
const report = buildApiContractsReport(input);

const validation = validateApiContracts(report);
assert(validation.ok, `expected schema validation to pass: ${validation.errors.join(', ')}`);

console.log('api contracts schema validation test passed');

const prior = structuredClone(report); prior.version = '1.1.0';
assert.equal(validateApiContracts(prior).ok, true);
delete prior.symbols[0].signature.parameters;
assert.equal(validateApiContracts(prior).ok, false, '1.1.0 retains its required formal authority after the 1.2.0 cutover');
prior.version = '1.0.0';
assert.equal(validateApiContracts(prior).ok, true, '1.0.0 legacy reports remain readable');

const observed = buildApiContractsReport({ ...input, callSites: [withFixtureCallArguments({
  callSiteId: 'schema-call', targetChunkUid: 'chunk-1', file: 'use.js', args: ['1', '2'] })] });
assert.equal(validateApiContracts(observed).ok, true);
delete observed.symbols[0].observedCalls[0].arguments;
assert.equal(validateApiContracts(observed).ok, false, '1.2.0 requires independent argument authority');
observed.version = '1.1.0';
assert.equal(validateApiContracts(observed).ok, true, '1.1.0 predates the independent argument field');
