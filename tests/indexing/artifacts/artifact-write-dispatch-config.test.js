#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveArtifactWriteDispatchConfig } from '../../../src/index/build/artifacts/write-dispatch-config.js';

applyTestEnv({ testing: '1' });

const defaults = resolveArtifactWriteDispatchConfig({
  artifactConfig: {},
  writeFsStrategy: { tailWorker: false }
});

assert.equal(defaults.heavyWriteThresholdBytes, 16 * 1024 * 1024);
assert.equal(defaults.ultraLightWriteThresholdBytes, 64 * 1024);
assert.equal(defaults.massiveWriteThresholdBytes, 128 * 1024 * 1024);
assert.equal(defaults.adaptiveWriteConcurrencyEnabled, true);
assert.equal(defaults.adaptiveWriteMinConcurrency, 1);
assert.equal(defaults.adaptiveWriteScaleUpCooldownMs, 400);
assert.equal(defaults.writeTailRescueEnabled, true);
assert.equal(defaults.writeTailWorkerEnabled, false);
assert.equal(defaults.writeTailWorkerMaxPending, 4);
assert.equal(
  defaults.forcedHeavyWritePatterns.some((pattern) => pattern.test('chunks/chunk_meta.json')),
  true,
  'expected default heavy patterns to include chunk_meta artifacts'
);
assert.equal(
  defaults.forcedUltraLightWritePatterns.some((pattern) => pattern.test('pieces/manifest.json')),
  true,
  'expected default ultra-light patterns to include pieces manifest artifacts'
);
assert.equal(
  defaults.forcedMassiveWritePatterns.some((pattern) => pattern.test('postings/token_postings.binary-columnar.jsonl')),
  true,
  'expected default massive patterns to include token postings columnar artifacts'
);

const overrides = resolveArtifactWriteDispatchConfig({
  artifactConfig: {
    writeHeavyThresholdBytes: 2 * 1024 * 1024,
    writeUltraLightThresholdBytes: 2048,
    writeMassiveThresholdBytes: 12 * 1024 * 1024,
    writeHeavyLabelPatterns: ['custom-heavy'],
    writeUltraLightLabelPatterns: ['custom-light'],
    writeMassiveLabelPatterns: ['custom-massive'],
    writeMassiveIoTokens: 3,
    writeMassiveMemTokens: 4,
    writeSmallConcurrency: 2,
    writeWorkClassMediumConcurrency: 5,
    writeMassiveConcurrency: 7,
    writeAdaptiveConcurrency: false,
    writeAdaptiveMinConcurrency: 3,
    writeAdaptiveStartConcurrency: 4,
    writeAdaptiveScaleUpBacklogPerSlot: 2.5,
    writeAdaptiveScaleDownBacklogPerSlot: 0.2,
    writeAdaptiveStallScaleDownSeconds: 12,
    writeAdaptiveStallScaleUpGuardSeconds: 6,
    writeAdaptiveScaleUpCooldownMs: 900,
    writeAdaptiveScaleDownCooldownMs: 1800,
    writeTailRescue: false,
    writeTailRescueMaxPending: 6,
    writeTailRescueStallSeconds: 20,
    writeTailRescueBoostIoTokens: 2,
    writeTailRescueBoostMemTokens: 3,
    writeTailWorkerMaxPending: 9
  },
  writeFsStrategy: { tailWorker: true }
});

assert.equal(overrides.heavyWriteThresholdBytes, 2 * 1024 * 1024);
assert.equal(overrides.ultraLightWriteThresholdBytes, 2048);
assert.equal(overrides.massiveWriteThresholdBytes, 12 * 1024 * 1024);
assert.equal(overrides.forcedHeavyWritePatterns.length, 1);
assert.equal(overrides.forcedHeavyWritePatterns[0].test('custom-heavy'), true);
assert.equal(overrides.forcedUltraLightWritePatterns[0].test('custom-light'), true);
assert.equal(overrides.forcedMassiveWritePatterns[0].test('custom-massive'), true);
assert.equal(overrides.massiveWriteIoTokens, 3);
assert.equal(overrides.massiveWriteMemTokens, 4);
assert.equal(overrides.workClassSmallConcurrencyOverride, 2);
assert.equal(overrides.workClassMediumConcurrencyOverride, 5);
assert.equal(overrides.workClassLargeConcurrencyOverride, 7);
assert.equal(overrides.adaptiveWriteConcurrencyEnabled, false);
assert.equal(overrides.adaptiveWriteMinConcurrency, 3);
assert.equal(overrides.adaptiveWriteStartConcurrencyOverride, 4);
assert.equal(overrides.adaptiveWriteScaleUpBacklogPerSlot, 2.5);
assert.equal(overrides.adaptiveWriteScaleDownBacklogPerSlot, 0.2);
assert.equal(overrides.adaptiveWriteStallScaleDownSeconds, 12);
assert.equal(overrides.adaptiveWriteStallScaleUpGuardSeconds, 6);
assert.equal(overrides.adaptiveWriteScaleUpCooldownMs, 900);
assert.equal(overrides.adaptiveWriteScaleDownCooldownMs, 1800);
assert.equal(overrides.writeTailRescueEnabled, false);
assert.equal(overrides.writeTailRescueMaxPending, 6);
assert.equal(overrides.writeTailRescueStallSeconds, 20);
assert.equal(overrides.writeTailRescueBoostIoTokens, 2);
assert.equal(overrides.writeTailRescueBoostMemTokens, 3);
assert.equal(overrides.writeTailWorkerEnabled, true);
assert.equal(overrides.writeTailWorkerMaxPending, 9);

console.log('artifact write dispatch config test passed');
