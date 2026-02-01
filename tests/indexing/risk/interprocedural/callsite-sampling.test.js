#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCallSiteId } from '../../../../src/index/callsite-id.js';
import { sampleCallSitesForEdge } from '../../../../src/index/risk-interprocedural/edges.js';

const calleeUid = 'uid-b';
const callerFile = 'src/root.js';
const callDetails = [
  {
    targetChunkUid: calleeUid,
    startLine: 2,
    startCol: 1,
    endLine: 2,
    endCol: 10,
    calleeRaw: 'beta',
    calleeNormalized: 'beta',
    args: ['b']
  },
  {
    targetChunkUid: calleeUid,
    file: 'src/alpha.js',
    startLine: 9,
    startCol: 1,
    endLine: 9,
    endCol: 10,
    calleeRaw: 'alpha',
    calleeNormalized: 'alpha',
    args: ['a']
  },
  {
    targetChunkUid: calleeUid,
    startLine: 1,
    startCol: 2,
    endLine: 1,
    endCol: 8,
    calleeRaw: 'gamma',
    calleeNormalized: 'gamma',
    args: ['c']
  },
  {
    targetChunkUid: 'uid-c',
    startLine: 1,
    startCol: 1,
    endLine: 1,
    endCol: 2,
    calleeRaw: 'skip',
    calleeNormalized: 'skip',
    args: ['x']
  }
];

const samples = sampleCallSitesForEdge(callDetails, {
  calleeUid,
  callerFile,
  maxCallSitesPerEdge: 2
});

const expectedFirst = buildCallSiteId({
  file: 'src/alpha.js',
  startLine: 9,
  startCol: 1,
  endLine: 9,
  endCol: 10,
  calleeRaw: 'alpha'
});
const expectedSecond = buildCallSiteId({
  file: callerFile,
  startLine: 1,
  startCol: 2,
  endLine: 1,
  endCol: 8,
  calleeRaw: 'gamma'
});

assert.equal(samples.length, 2, 'expected two sampled callsites');
assert.equal(samples[0].callSiteId, expectedFirst, 'first sample should use deterministic sort order');
assert.equal(samples[1].callSiteId, expectedSecond, 'second sample should use deterministic sort order');
assert.deepEqual(samples[0].args, ['a']);
assert.deepEqual(samples[1].args, ['c']);

console.log('callsite sampling test passed');
