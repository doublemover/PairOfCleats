#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTokenPostingsPlan } from '../../../src/index/build/artifacts/token-postings.js';

const postings = {
  tokenVocab: ['alpha', 'beta', 'gamma'],
  tokenPostingsList: [
    [[0, 1]],
    [[1, 2]],
    [[2, 3]]
  ]
};

const logs = [];
const plan = resolveTokenPostingsPlan({
  artifactMode: 'sharded',
  tokenPostingsFormatConfig: 'auto',
  tokenPostingsShardSize: null,
  tokenPostingsShardThreshold: 1,
  postings,
  maxJsonBytes: 256,
  maxJsonBytesSoft: 1,
  shardTargetBytes: 128,
  log: (line) => logs.push(line)
});

assert.equal(plan.tokenPostingsUseShards, true, 'expected plan to choose shard output');
assert.ok(Number.isFinite(plan.tokenPostingsShardSize), 'expected shard size to remain finite');
assert.ok(plan.tokenPostingsShardSize > 0, 'expected shard size to remain positive');
assert.equal(Number.isNaN(plan.tokenPostingsShardSize), false, 'expected shard size to avoid NaN');

console.log('token postings shard size guard test passed');
