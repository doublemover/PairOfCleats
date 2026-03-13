#!/usr/bin/env node
import assert from 'node:assert/strict';
import { fixtureIndexInternals } from './fixture-index.js';

const readTestConfig = (env) => JSON.parse(env.PAIROFCLEATS_TEST_CONFIG || '{}');

const baseEnv = fixtureIndexInternals.createFixtureEnv('.testCache/helper-risk-config');
const baseConfig = readTestConfig(baseEnv);
assert.equal(baseConfig.indexing?.riskAnalysis, false, 'fixture env should disable risk analysis by default');
assert.equal(baseConfig.indexing?.riskAnalysisCrossFile, false, 'fixture env should disable cross-file risk by default');

const riskEnv = fixtureIndexInternals.createFixtureEnv(
  '.testCache/helper-risk-config',
  {},
  { requireCodeRiskTags: true }
);
const riskConfig = readTestConfig(riskEnv);
assert.equal(riskConfig.indexing?.riskAnalysis, true, 'requireCodeRiskTags should enable risk analysis');
assert.equal(riskConfig.indexing?.riskAnalysisCrossFile, true, 'requireCodeRiskTags should enable cross-file risk analysis');

console.log('fixture-index risk config test passed');
