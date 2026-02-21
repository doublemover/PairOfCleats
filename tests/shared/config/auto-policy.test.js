#!/usr/bin/env node
import { buildAutoPolicy } from '../../../src/shared/auto-policy.js';

const assertEqual = (label, actual, expected) => {
  if (actual !== expected) {
    console.error(`${label} expected ${expected}, got ${actual}`);
    process.exit(1);
  }
};

const baseRepo = { fileCount: 1000, totalBytes: 1024, truncated: false, huge: false };

const fastPolicy = await buildAutoPolicy({
  config: { quality: 'auto' },
  resources: { cpuCount: 4, memoryGb: 8 },
  repo: baseRepo
});
assertEqual('auto quality on low resources', fastPolicy.quality.value, 'fast');

const hugePolicy = await buildAutoPolicy({
  config: { quality: 'auto' },
  resources: { cpuCount: 16, memoryGb: 64 },
  repo: { ...baseRepo, huge: true }
});
assertEqual('auto quality on huge repo', hugePolicy.quality.value, 'balanced');
assertEqual(
  'huge profile write queue weight',
  hugePolicy?.indexing?.hugeRepoProfile?.overrides?.scheduler?.queues?.['stage2.write']?.weight,
  5
);
assertEqual(
  'huge profile sqlite queue weight',
  hugePolicy?.indexing?.hugeRepoProfile?.overrides?.scheduler?.queues?.['stage4.sqlite']?.weight,
  5
);

const explicitPolicy = await buildAutoPolicy({
  config: { quality: 'balanced' },
  resources: { cpuCount: 16, memoryGb: 64 },
  repo: { ...baseRepo, huge: true }
});
assertEqual('explicit quality override', explicitPolicy.quality.value, 'balanced');

console.log('auto policy test passed');
