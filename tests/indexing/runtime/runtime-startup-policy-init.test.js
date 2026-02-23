#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveRuntimeStartupPolicyState } from '../../../src/index/build/runtime/runtime-startup-policy-init.js';

applyTestEnv();

const createTimeInitRecorder = () => {
  const labels = [];
  return {
    labels,
    timeInit: async (label, loader) => {
      labels.push(label);
      return loader();
    }
  };
};

{
  const { labels, timeInit } = createTimeInitRecorder();
  const cacheRoot = path.join(process.cwd(), '.tmp', 'runtime-startup-policy-init');
  const result = await resolveRuntimeStartupPolicyState({
    root: process.cwd(),
    argv: { stage: 'stage1', quality: ' MAX ' },
    rawArgv: [],
    policy: {
      profile: {
        id: 'provided',
        enabled: true
      }
    },
    userConfig: {
      cache: { root: cacheRoot },
      indexing: {
        profile: 'default',
        indexOptimizationProfile: 'not-a-profile',
        embeddings: { enabled: true, mode: 'auto' },
        autoProfile: { enabled: false },
        scm: { annotate: { enabled: false } },
        twoStage: {
          stage1: {
            artifacts: { writeFsStrategy: 'stage1-custom' },
            scm: { maxConcurrentProcesses: 9 }
          }
        }
      }
    },
    envConfig: {
      stage: null,
      benchRun: false,
      cacheRoot: null,
      xxhashBackend: null
    },
    log: () => {},
    timeInit
  });

  assert.equal(result.autoPolicyProvided, true, 'expected provided policy to skip auto-policy build');
  assert.equal(result.policyConfig.quality, 'max', 'expected quality override to normalize and apply');
  assert.equal(result.stage, 'stage1', 'expected stage override normalization');
  assert.equal(result.baseEmbeddingsPlanned, true, 'expected base embedding plan captured pre-stage overrides');
  assert.equal(result.indexingConfig.embeddings.enabled, false, 'expected stage1 defaults to disable embeddings');
  assert.equal(result.indexingConfig.embeddings.mode, 'off', 'expected stage1 defaults to force embeddings mode off');
  assert.equal(result.indexingConfig.artifacts.writeFsStrategy, 'stage1-custom', 'expected stage override to win before platform preset fallback');
  assert.equal(result.indexingConfig.scm.maxConcurrentProcesses, 9, 'expected stage scm override to suppress preset fallback');
  assert.equal(result.indexOptimizationProfile, 'default', 'expected index optimization profile normalization');
  assert.equal(result.indexingConfig.indexOptimizationProfile, 'default', 'expected normalized optimization profile in indexing config');
  assert.equal(result.profile.id, 'default', 'expected profile normalization to known profile ids');
  assert.deepEqual(labels, ['learned auto profile'], 'expected only learned-profile timing when policy is provided');
}

{
  const { timeInit } = createTimeInitRecorder();
  const result = await resolveRuntimeStartupPolicyState({
    root: process.cwd(),
    argv: {},
    rawArgv: ['--no-scm-annotate', '--scm-annotate'],
    policy: { profile: { id: 'provided', enabled: true } },
    userConfig: {
      indexing: {
        profile: 'default',
        autoProfile: { enabled: false },
        scm: {
          annotate: {
            enabled: false
          }
        }
      },
      analysisPolicy: {
        git: {
          blame: false
        }
      }
    },
    envConfig: {
      stage: null,
      benchRun: false,
      cacheRoot: null,
      xxhashBackend: null
    },
    log: () => {},
    timeInit
  });

  assert.equal(result.indexingConfig.scm.annotate.enabled, true, 'expected CLI annotate override to apply before scm policy assembly');
  assert.equal(result.scmConfig.annotate.enabled, true, 'expected resolved scm config to use CLI annotate override');
}

console.log('runtime startup policy init test passed');
