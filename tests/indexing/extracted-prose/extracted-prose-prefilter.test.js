#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  EXTRACTED_PROSE_YIELD_PROFILE_SKIP_REASON_CODE,
  resolveExtractedProsePrefilterDecision,
  resolvePreReadSkip
} from '../../../src/index/build/file-processor/skip.js';
import { buildGeneratedPolicyConfig } from '../../../src/index/build/generated-policy.js';

const tinySkip = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  fileStat: { size: 64 }
});
assert.equal(tinySkip?.reason, 'extracted-prose-prefilter', 'expected prefilter skip reason for tiny files');
assert.equal(tinySkip?.prefilterClass, 'tiny-file', 'expected tiny-file class');

const codeAllowed = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  languageId: 'javascript',
  fileStat: { size: 2048 }
});
assert.equal(codeAllowed, null, 'expected recognized code language to pass extracted-prose prefilter');

const unknownSkip = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  fileStat: { size: 2048 }
});
assert.equal(unknownSkip?.prefilterClass, 'non-doc-extension', 'expected unknown non-doc extension to be prefiltered');

const docsAllowed = resolveExtractedProsePrefilterDecision({
  relPath: 'docs/guide.md',
  ext: '.md',
  mode: 'extracted-prose',
  languageId: 'markdown',
  fileStat: { size: 4096 }
});
assert.equal(docsAllowed, null, 'expected markdown docs file to pass extracted-prose prefilter');

const policyDisabled = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  languageId: 'javascript',
  fileStat: { size: 4096 },
  generatedPolicy: {
    extractedProse: {
      prefilter: { enabled: false }
    }
  }
});
assert.equal(policyDisabled, null, 'expected generated policy to disable extracted-prose prefilter');

const runtimePolicyDisabled = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  languageId: 'javascript',
  fileStat: { size: 4096 },
  generatedPolicy: buildGeneratedPolicyConfig({
    extractedProse: {
      prefilter: { enabled: false }
    }
  })
});
assert.equal(
  runtimePolicyDisabled,
  null,
  'expected build-generated policy to preserve extracted-prose prefilter overrides'
);

const profileSkip = await resolvePreReadSkip({
  abs: 'C:\\repo\\src\\main.js',
  rel: 'src/main.js',
  fileEntry: { lines: 12 },
  fileStat: { size: 4096 },
  ext: '.js',
  fileCaps: null,
  fileScanner: {
    binary: { maxNonTextRatio: 0.3 },
    scanFile: async () => ({ skip: null })
  },
  runIo: async (fn) => fn(),
  languageId: 'javascript',
  mode: 'extracted-prose',
  generatedPolicy: buildGeneratedPolicyConfig({}),
  extractedProseYieldProfile: {
    builds: 2,
    totals: { observedFiles: 500, yieldedFiles: 0, chunkCount: 0 },
    config: {
      enabled: true,
      minBuilds: 1,
      minProfileSamples: 100,
      minFamilySamples: 10,
      maxYieldRatio: 0,
      maxYieldedFiles: 0
    },
    families: {
      '.js|src': {
        observedFiles: 80,
        yieldedFiles: 0,
        chunkCount: 0,
        yieldRatio: 0
      }
    }
  }
});
assert.equal(profileSkip?.reason, 'extracted-prose-yield-profile', 'expected persisted yield profile skip reason');
assert.equal(
  profileSkip?.reasonCode,
  EXTRACTED_PROSE_YIELD_PROFILE_SKIP_REASON_CODE,
  'expected persisted yield profile reason code'
);

const profileDisabled = await resolvePreReadSkip({
  abs: 'C:\\repo\\src\\main.js',
  rel: 'src/main.js',
  fileEntry: { lines: 12 },
  fileStat: { size: 4096 },
  ext: '.js',
  fileCaps: null,
  fileScanner: {
    binary: { maxNonTextRatio: 0.3 },
    scanFile: async () => ({ skip: null })
  },
  runIo: async (fn) => fn(),
  languageId: 'javascript',
  mode: 'extracted-prose',
  generatedPolicy: buildGeneratedPolicyConfig({}),
  extractedProseYieldProfile: {
    builds: 2,
    totals: { observedFiles: 500, yieldedFiles: 0, chunkCount: 0 },
    config: {
      enabled: false,
      minBuilds: 1,
      minProfileSamples: 100,
      minFamilySamples: 10,
      maxYieldRatio: 0,
      maxYieldedFiles: 0
    },
    families: {
      '.js|src': {
        observedFiles: 80,
        yieldedFiles: 0,
        chunkCount: 0,
        yieldRatio: 0
      }
    }
  }
});
assert.equal(profileDisabled, null, 'expected profile prefilter opt-out to bypass persisted skip');

console.log('extracted prose prefilter test passed');
