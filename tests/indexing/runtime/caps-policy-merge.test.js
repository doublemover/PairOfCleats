#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveFileCapsAndGuardrails } from '../../../src/index/build/runtime/caps.js';
import { LANGUAGE_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

const MB = 1024 * 1024;

const { maxFileBytes, fileCaps, guardrails } = resolveFileCapsAndGuardrails({
  maxFileBytes: 8 * MB,
  fileCaps: {
    default: { maxBytes: 6 * MB, maxLines: 5000 },
    byExt: { '.js': { maxBytes: 2 * MB } },
    byLanguage: { javascript: { maxLines: 1000 } },
    byMode: { prose: { maxBytes: 4 * MB } }
  },
  untrusted: {
    enabled: true,
    maxFileBytes: 1 * MB,
    maxLines: 200
  }
});

assert.equal(guardrails.enabled, true, 'guardrails should be enabled');
assert.equal(maxFileBytes, 1 * MB, 'maxFileBytes should clamp to untrusted');
assert.equal(fileCaps.default.maxBytes, 1 * MB, 'default maxBytes should clamp');
assert.equal(fileCaps.default.maxLines, 200, 'default maxLines should clamp');
assert.equal(fileCaps.byExt['.js'].maxBytes, 1 * MB, 'ext maxBytes should clamp');
assert.equal(
  fileCaps.byLanguage.javascript.maxBytes,
  LANGUAGE_CAPS_BASELINES.javascript.maxBytes,
  'language maxBytes should preserve calibrated baseline when already below guardrail'
);
assert.equal(fileCaps.byLanguage.javascript.maxLines, 200, 'language maxLines should clamp');
assert.equal(fileCaps.byMode.prose.maxBytes, 1 * MB, 'mode maxBytes should clamp');

console.log('build runtime caps policy merge test passed');
