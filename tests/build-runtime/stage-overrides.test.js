#!/usr/bin/env node
import { buildStageOverrides, normalizeStage } from '../../src/index/build/runtime/stage.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (normalizeStage('stage1') !== 'stage1') {
  fail('normalizeStage should match stage1.');
}
if (normalizeStage('embed') !== 'stage3') {
  fail('normalizeStage should map embed to stage3.');
}
if (normalizeStage('ann') !== 'stage4') {
  fail('normalizeStage should map ann to stage4.');
}
if (normalizeStage('') !== null) {
  fail('normalizeStage should return null for empty input.');
}

const stage1Overrides = buildStageOverrides({ stage1: { lint: true } }, 'stage1');
if (!stage1Overrides || stage1Overrides.lint !== true) {
  fail('stage1 overrides should merge explicit values.');
}
if (stage1Overrides.embeddings?.enabled !== false) {
  fail('stage1 overrides should disable embeddings.');
}
if (stage1Overrides.treeSitter?.enabled !== false) {
  fail('stage1 overrides should disable tree-sitter.');
}
if (stage1Overrides.typeInference !== false) {
  fail('stage1 overrides should disable type inference.');
}

const stage2Overrides = buildStageOverrides({ stage2: { lint: false, embeddings: { enabled: true } } }, 'stage2');
if (!stage2Overrides || stage2Overrides.embeddings?.enabled !== true) {
  fail('stage2 overrides should preserve explicit embeddings config.');
}

const stage3Overrides = buildStageOverrides({ stage3: { lint: true } }, 'stage3');
if (!stage3Overrides || stage3Overrides.lint !== true) {
  fail('stage3 overrides should merge explicit values.');
}
if (stage3Overrides.treeSitter?.enabled !== false) {
  fail('stage3 overrides should disable tree-sitter.');
}

if (buildStageOverrides({}, 'unknown') !== null) {
  fail('buildStageOverrides should return null for unknown stages.');
}

console.log('build runtime stage overrides tests passed');
