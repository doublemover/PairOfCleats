#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTokenPostingsPlan } from '../../../src/index/build/artifacts/token-postings.js';

applyTestEnv();

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

const autoPackedPlan = resolveTokenPostingsPlan({
  artifactMode: 'auto',
  tokenPostingsFormatConfig: 'auto',
  tokenPostingsShardSize: 10,
  tokenPostingsShardThreshold: 1000,
  tokenPostingsBinaryColumnar: true,
  tokenPostingsPackedAutoThresholdBytes: 1,
  postings,
  maxJsonBytes: 4096,
  maxJsonBytesSoft: 2048,
  shardTargetBytes: 1024,
  log: () => {}
});

assert.equal(autoPackedPlan.tokenPostingsFormat, 'packed', 'expected auto mode to switch to packed');
assert.equal(autoPackedPlan.tokenPostingsUseShards, false, 'expected packed plan to disable sharding');

console.log('token postings shard size guard test passed');
