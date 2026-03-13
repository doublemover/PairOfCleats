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

const interactiveDefault = resolveScmConfig({
  indexingConfig: {},
  analysisPolicy: null,
  workload: 'interactive'
});
assert.equal(
  interactiveDefault.allowSlowTimeouts === true,
  false,
  'expected interactive SCM config to keep aggressive timeout caps by default'
);

const batchDefault = resolveScmConfig({
  indexingConfig: {},
  analysisPolicy: null,
  workload: 'batch'
});
assert.equal(batchDefault.allowSlowTimeouts, true, 'expected batch SCM config to enable slow-timeout path by default');
assert.equal(
  batchDefault.annotate.allowSlowTimeouts,
  true,
  'expected batch SCM annotate config to enable slow-timeout path by default'
);

const batchExplicitDisable = resolveScmConfig({
  indexingConfig: { scm: { allowSlowTimeouts: false, annotate: { allowSlowTimeouts: false } } },
  analysisPolicy: null,
  workload: 'batch'
});
assert.equal(
  batchExplicitDisable.allowSlowTimeouts,
  false,
  'expected batch SCM config to respect explicit allowSlowTimeouts=false'
);
assert.equal(
  batchExplicitDisable.annotate.allowSlowTimeouts,
  false,
  'expected batch SCM annotate config to respect explicit allowSlowTimeouts=false'
);

console.log('scm config bench annotate default test passed');
