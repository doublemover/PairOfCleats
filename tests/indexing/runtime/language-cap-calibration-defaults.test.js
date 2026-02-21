#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';
import { LANGUAGE_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

applyTestEnv();

const { fileCaps } = resolveFileCapsAndGuardrails({
  maxFileBytes: 5 * 1024 * 1024,
  fileCaps: {}
});

for (const [languageId, baseline] of Object.entries(LANGUAGE_CAPS_BASELINES)) {
  const resolved = fileCaps.byLanguage[languageId];
  assert.ok(resolved, `missing calibrated byLanguage cap for ${languageId}`);
  assert.equal(resolved.maxBytes, baseline.maxBytes, `maxBytes calibration mismatch for ${languageId}`);
  assert.equal(resolved.maxLines, baseline.maxLines, `maxLines calibration mismatch for ${languageId}`);
}

const clikeBaseline = LANGUAGE_CAPS_BASELINES.clike;
assert.equal(fileCaps.byExt['.m']?.maxBytes, clikeBaseline.maxBytes, 'expected .m maxBytes to default to clike baseline');
assert.equal(fileCaps.byExt['.m']?.maxLines, clikeBaseline.maxLines, 'expected .m maxLines to default to clike baseline');
assert.equal(fileCaps.byExt['.mm']?.maxBytes, clikeBaseline.maxBytes, 'expected .mm maxBytes to default to clike baseline');
assert.equal(fileCaps.byExt['.mm']?.maxLines, clikeBaseline.maxLines, 'expected .mm maxLines to default to clike baseline');

const partialOverride = resolveFileCapsAndGuardrails({
  maxFileBytes: 5 * 1024 * 1024,
  fileCaps: {
    byLanguage: {
      javascript: { maxBytes: 64 * 1024 }
    }
  }
});
assert.equal(partialOverride.fileCaps.byLanguage.javascript.maxBytes, 64 * 1024, 'expected language maxBytes override to apply');
assert.equal(
  partialOverride.fileCaps.byLanguage.javascript.maxLines,
  LANGUAGE_CAPS_BASELINES.javascript.maxLines,
  'expected language maxLines baseline to be preserved for partial overrides'
);

console.log('language cap calibration defaults test passed');
