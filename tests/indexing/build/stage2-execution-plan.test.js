#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildStage2ExecutionPlan } from '../../../src/integrations/core/build-index/stages.js';

const fullPlan = buildStage2ExecutionPlan(['code', 'prose', 'extracted-prose', 'records']);
assert.deepEqual(
  fullPlan.map((entry) => entry.id),
  ['code', 'prose+extracted-prose', 'records'],
  'expected prose/extracted-prose to fuse into one stage2 execution group'
);
assert.deepEqual(
  fullPlan[1]?.modes,
  ['prose', 'extracted-prose'],
  'expected fused group to execute prose before extracted-prose'
);
assert.equal(fullPlan[1]?.fusedProsePair, true, 'expected fused prose pair marker');

const reversedPairPlan = buildStage2ExecutionPlan(['extracted-prose', 'prose']);
assert.equal(reversedPairPlan.length, 1, 'expected only one fused group for prose pair');
assert.deepEqual(
  reversedPairPlan[0]?.modes,
  ['prose', 'extracted-prose'],
  'expected fused group ordering to stay deterministic'
);

const noPairPlan = buildStage2ExecutionPlan(['code', 'prose']);
assert.deepEqual(
  noPairPlan.map((entry) => entry.id),
  ['code', 'prose'],
  'expected non-paired modes to remain independent'
);

console.log('stage2 execution plan test passed');
