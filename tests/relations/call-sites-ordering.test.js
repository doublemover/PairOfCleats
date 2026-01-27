#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCallSites } from '../../src/index/build/artifacts/writers/call-sites.js';

const chunks = [
  {
    id: 1,
    file: 'b.ts',
    lang: 'typescript',
    codeRelations: {
      callDetails: [
        {
          caller: 'beta',
          callee: 'zeta.do',
          start: 20,
          end: 24,
          startLine: 2,
          startCol: 1,
          endLine: 2,
          endCol: 5,
          args: ['b']
        }
      ]
    }
  },
  {
    id: 0,
    file: 'a.ts',
    lang: 'typescript',
    codeRelations: {
      callDetails: [
        {
          caller: 'alpha',
          callee: 'alpha.run',
          start: 5,
          end: 9,
          startLine: 1,
          startCol: 1,
          endLine: 1,
          endCol: 5,
          args: ['a']
        }
      ]
    }
  }
];

const rows = createCallSites({ chunks });
const reversed = createCallSites({ chunks: [chunks[1], chunks[0]] });
assert.equal(rows.length, 2, 'expected two call_sites rows');
assert.equal(rows[0].file, 'a.ts', 'call_sites should be ordered by file');
assert.equal(rows[1].file, 'b.ts', 'call_sites should be ordered by file');
assert.equal(rows[0].calleeNormalized, 'run', 'calleeNormalized should be derived');
assert.deepEqual(rows, reversed, 'call_sites ordering should be deterministic');

console.log('call_sites ordering test passed');
