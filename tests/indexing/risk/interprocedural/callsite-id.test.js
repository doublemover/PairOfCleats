#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCallSiteId } from '../../../../src/index/callsite-id.js';
import { createCallSites } from '../../../../src/index/build/artifacts/writers/call-sites.js';

const chunk = {
  file: 'src/sample.js',
  lang: 'javascript',
  chunkUid: 'uid-1',
  codeRelations: {
    callDetails: [
      {
        callee: 'foo',
        calleeRaw: 'foo',
        calleeNormalized: 'foo',
        start: 10,
        end: 20,
        startLine: 2,
        startCol: 3,
        endLine: 2,
        endCol: 13,
        args: ['x']
      }
    ]
  }
};

const rows = createCallSites({ chunks: [chunk] });
assert.equal(rows.length, 1, 'expected a single callsite row');
const expected = buildCallSiteId({
  file: 'src/sample.js',
  startLine: 2,
  startCol: 3,
  endLine: 2,
  endCol: 13,
  calleeRaw: 'foo'
});
assert.equal(rows[0].callSiteId, expected, 'callSiteId should match shared helper');

console.log('callsite-id helper test passed');
