#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runAnnFallbackScenario } from './helpers/ann-scenarios.js';

const scenario = 'ann-missing-provider-fallback';
const { outputs, stageTracker } = await runAnnFallbackScenario({
  createAnnProviders: () => new Map(),
  runs: 1
});
const results = outputs[0];

assert.ok(Array.isArray(results) && results.length > 0, 'expected sparse results to return');

const annStage = stageTracker.stages.find((entry) => entry.stage === 'ann');
assert.ok(annStage, 'expected ann stage');
assert.equal(annStage.warned, true, 'expected ann fallback warning');
assert.equal(annStage.providerAvailable, false, 'expected ann provider to be unavailable');

console.log(`${scenario} test passed`);
