#!/usr/bin/env node
import { withFixtureCallArguments } from '../../helpers/call-arguments.js';
import assert from 'node:assert/strict';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';

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
].map(withFixtureCallArguments);

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

for (const maxWarnings of [0, 1, undefined]) {
  assert.throws(() => buildApiContractsReport({ symbols, callSites, failOnWarn: true,
    caps: maxWarnings === undefined ? {} : { maxWarnings }, indexCompatKey: 'compat-api-warning-detail-cap'
  }), error => {
    assert.equal(error.code, 'ERR_API_CONTRACT_WARN');
    assert.equal(validateApiContracts(error.report).ok, true);
    assert.equal(error.report.warnings?.length ?? 0, maxWarnings === 0 ? 0 : 1);
    const omitted = error.report.truncation?.find(entry => entry.cap === 'maxWarnings');
    if (maxWarnings === 0) assert.deepEqual(omitted,
      { scope: 'apiContracts', cap: 'maxWarnings', limit: 0, observed: 1, omitted: 1 });
    else assert.equal(omitted, undefined, 'an exactly filled detail cap does not imply omissions');
    return true;
  }, `detected violations must fail independently of the detail cap ${maxWarnings}`);
}

const clean = buildApiContractsReport({ symbols, callSites: [withFixtureCallArguments({ ...callSites[0], args: ['1', '2'] })],
  failOnWarn: true, caps: { maxWarnings: 0 }, indexCompatKey: 'compat-api-clean-zero-cap' });
assert.equal(clean.warnings, null);
assert.equal(clean.truncation, null, 'no detected warnings means no warning-detail omission');

console.log('api contracts fail-on-warn test passed');
