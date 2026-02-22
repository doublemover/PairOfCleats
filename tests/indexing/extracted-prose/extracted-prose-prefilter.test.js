#!/usr/bin/env node
import assert from 'node:assert/strict';

import { resolveExtractedProsePrefilterDecision } from '../../../src/index/build/file-processor/skip.js';
import { buildGeneratedPolicyConfig } from '../../../src/index/build/generated-policy.js';

const tinySkip = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  fileStat: { size: 64 }
});
assert.equal(tinySkip?.reason, 'extracted-prose-prefilter', 'expected prefilter skip reason for tiny files');
assert.equal(tinySkip?.prefilterClass, 'tiny-file', 'expected tiny-file class');

const codeSkip = resolveExtractedProsePrefilterDecision({
  relPath: 'src/main.js',
  ext: '.js',
  mode: 'extracted-prose',
  languageId: 'javascript',
  fileStat: { size: 2048 }
});
assert.equal(codeSkip?.prefilterClass, 'code-language', 'expected code-language class for extracted-prose code file');

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

console.log('extracted prose prefilter test passed');
