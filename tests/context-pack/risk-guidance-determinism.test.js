#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildRiskGuidance } from '../../src/context-pack/assemble/guidance.js';

const graphIndex = {
  callGraphIndex: new Map([
    ['sink-chunk', { file: 'src/sink.js', name: 'sink', kind: 'function', in: ['caller-b', 'caller-a'] }],
    ['path-chunk', { file: 'src/path.js', name: 'mid', kind: 'function', in: ['caller-c'] }]
  ]),
  symbolIndex: {
    byChunk: new Map([
      ['sink-chunk', [{ symbolId: 'sym-b', toRef: { resolved: { symbolId: 'sym-b', chunkUid: 'sink-chunk', path: 'src/sink.js', name: 'Sink', kind: 'function' } } }]],
      ['path-chunk', [{ symbolId: 'sym-a', toRef: { resolved: { symbolId: 'sym-a', chunkUid: 'path-chunk', path: 'src/path.js', name: 'Alpha', kind: 'function' } } }]]
    ])
  },
  graphRelations: {}
};

const chunkIndex = {
  byChunkUid: new Map([
    ['caller-a', { file: 'src/a.js', name: 'callerA', kind: 'function' }],
    ['caller-b', { file: 'src/b.js', name: 'callerB', kind: 'function' }],
    ['caller-c', { file: 'src/c.js', name: 'callerC', kind: 'function' }],
    ['sink-chunk', { file: 'src/sink.js', name: 'sink', kind: 'function' }],
    ['path-chunk', { file: 'src/path.js', name: 'mid', kind: 'function' }]
  ])
};

const flows = [{
  source: { chunkUid: 'source-chunk' },
  sink: { chunkUid: 'sink-chunk' },
  path: {
    nodes: [
      { type: 'chunk', chunkUid: 'path-chunk' }
    ]
  }
}];

const guidanceA = buildRiskGuidance({
  flows,
  graphIndex,
  chunkIndex,
  repoRoot: process.cwd(),
  indexCompatKey: 'compat'
});
const guidanceB = buildRiskGuidance({
  flows,
  graphIndex,
  chunkIndex,
  repoRoot: process.cwd(),
  indexCompatKey: 'compat'
});

assert.deepEqual(guidanceA, guidanceB);
assert.equal(guidanceA.callers[0].chunkUid, 'caller-a');
assert.equal(guidanceA.callers[1].chunkUid, 'caller-b');
assert.equal(guidanceA.symbols[0].symbolId, 'sym-b');

console.log('risk guidance determinism test passed');
