#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createImportResolutionBudgetPolicy } from '../../../src/index/build/import-resolution.js';

const defaultPolicy = createImportResolutionBudgetPolicy();
assert.equal(defaultPolicy.maxFilesystemProbesPerSpecifier, 32);
assert.equal(defaultPolicy.maxFallbackCandidatesPerSpecifier, 48);
assert.equal(defaultPolicy.maxFallbackDepth, 16);
assert.equal(defaultPolicy.adaptiveEnabled, true);
assert.equal(defaultPolicy.adaptiveProfile, 'normal');
assert.equal(defaultPolicy.adaptiveScale, 1);

const pressurePolicy = createImportResolutionBudgetPolicy({
  runtimeSignals: {
    scheduler: {
      utilizationOverall: 0.5,
      pending: 128,
      running: 4,
      memoryPressure: 0.95,
      fdPressure: 0.4
    },
    envelope: {
      cpuConcurrency: 8,
      ioConcurrency: 8
    }
  }
});
assert.equal(pressurePolicy.adaptiveProfile, 'pressure_critical');
assert.equal(pressurePolicy.maxFilesystemProbesPerSpecifier, 16);
assert.equal(pressurePolicy.maxFallbackCandidatesPerSpecifier, 24);
assert.equal(pressurePolicy.maxFallbackDepth, 12);
assert.ok(
  pressurePolicy.fingerprint !== defaultPolicy.fingerprint,
  'expected adaptive budget shift to alter fingerprint'
);

const headroomPolicy = createImportResolutionBudgetPolicy({
  runtimeSignals: {
    scheduler: {
      utilizationOverall: 0.9,
      pending: 4,
      running: 2,
      memoryPressure: 0.2,
      fdPressure: 0.2
    },
    envelope: {
      cpuConcurrency: 16,
      ioConcurrency: 12
    }
  }
});
assert.equal(headroomPolicy.adaptiveProfile, 'capacity_headroom');
assert.ok(
  headroomPolicy.maxFilesystemProbesPerSpecifier > defaultPolicy.maxFilesystemProbesPerSpecifier,
  'expected capacity headroom profile to expand fs probe budget'
);
assert.ok(
  headroomPolicy.maxFallbackCandidatesPerSpecifier > defaultPolicy.maxFallbackCandidatesPerSpecifier,
  'expected capacity headroom profile to expand fallback candidate budget'
);
assert.ok(
  headroomPolicy.maxFallbackDepth > defaultPolicy.maxFallbackDepth,
  'expected capacity headroom profile to expand fallback depth budget'
);

const explicitPolicy = createImportResolutionBudgetPolicy({
  resolverPlugins: {
    budgets: {
      maxFilesystemProbesPerSpecifier: 10,
      maxFallbackCandidatesPerSpecifier: 20,
      maxFallbackDepth: 5
    }
  },
  runtimeSignals: {
    scheduler: {
      utilizationOverall: 0.2,
      pending: 512,
      running: 1,
      memoryPressure: 0.99,
      fdPressure: 0.99
    },
    envelope: {
      cpuConcurrency: 16,
      ioConcurrency: 16
    }
  }
});
assert.equal(explicitPolicy.maxFilesystemProbesPerSpecifier, 10);
assert.equal(explicitPolicy.maxFallbackCandidatesPerSpecifier, 20);
assert.equal(explicitPolicy.maxFallbackDepth, 5);

const disabledAdaptivePolicy = createImportResolutionBudgetPolicy({
  resolverPlugins: {
    budgets: {
      adaptive: false
    }
  },
  runtimeSignals: {
    scheduler: {
      utilizationOverall: 0.2,
      pending: 512,
      running: 1,
      memoryPressure: 0.99,
      fdPressure: 0.99
    },
    envelope: {
      cpuConcurrency: 16,
      ioConcurrency: 16
    }
  }
});
assert.equal(disabledAdaptivePolicy.adaptiveEnabled, false);
assert.equal(disabledAdaptivePolicy.adaptiveProfile, 'disabled');
assert.equal(disabledAdaptivePolicy.adaptiveScale, 1);
assert.equal(disabledAdaptivePolicy.maxFilesystemProbesPerSpecifier, 32);
assert.equal(disabledAdaptivePolicy.maxFallbackCandidatesPerSpecifier, 48);
assert.equal(disabledAdaptivePolicy.maxFallbackDepth, 16);

console.log('import resolution adaptive budget policy tests passed');
