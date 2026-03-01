#!/usr/bin/env node
import assert from 'node:assert';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';

const symbols = [
  {
    symbolId: 'sym-1',
    chunkUid: 'chunk-1',
    file: 'src/api.js',
    name: 'apiFn',
    kind: 'function',
    signature: 'apiFn(a, b)'
  }
];

const callSites = Array.from({ length: 50 }, (_, idx) => ({
  callSiteId: `call-${String(idx).padStart(2, '0')}`,
  targetChunkUid: 'chunk-1',
  file: `src/file-${String(50 - idx).padStart(2, '0')}.js`,
  startLine: 100 - idx,
  args: ['a', 'b']
}));

const buildReport = () => buildApiContractsReport({
  symbols,
  callSites,
  now: () => '2026-02-04T00:00:00.000Z',
  indexSignature: 'api-contracts-large',
  indexCompatKey: 'compat-api-contracts-large'
});

const first = buildReport();
const second = buildReport();

assert.deepStrictEqual(second, first);
console.log('api contracts large call sites test passed');
