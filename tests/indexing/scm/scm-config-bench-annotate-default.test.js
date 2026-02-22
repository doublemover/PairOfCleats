#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveScmConfig } from '../../../src/index/scm/registry.js';

const benchDefault = resolveScmConfig({
  indexingConfig: {},
  analysisPolicy: null,
  benchRun: true
});
assert.equal(benchDefault.annotate.enabled, false, 'expected bench runs to default scm annotate off');

const benchExplicitEnable = resolveScmConfig({
  indexingConfig: { scm: { annotate: { enabled: true } } },
  analysisPolicy: null,
  benchRun: true
});
assert.equal(benchExplicitEnable.annotate.enabled, true, 'expected explicit annotate enable to override bench default');

const benchPolicyEnable = resolveScmConfig({
  indexingConfig: {},
  analysisPolicy: { git: { blame: true } },
  benchRun: true
});
assert.equal(benchPolicyEnable.annotate.enabled, true, 'expected analysis policy blame=true to override bench default');

const normalDefault = resolveScmConfig({
  indexingConfig: {},
  analysisPolicy: null,
  benchRun: false
});
assert.equal(normalDefault.annotate.enabled, true, 'expected non-bench runs to keep annotate enabled by default');

const explicitGitBlameDisable = resolveScmConfig({
  indexingConfig: { gitBlame: false },
  analysisPolicy: null,
  benchRun: false
});
assert.equal(explicitGitBlameDisable.annotate.enabled, false, 'expected explicit gitBlame=false to disable annotate');

console.log('scm config bench annotate default test passed');
