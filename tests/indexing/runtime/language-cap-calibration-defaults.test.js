#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';
import { LANGUAGE_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

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

console.log('language cap calibration defaults test passed');