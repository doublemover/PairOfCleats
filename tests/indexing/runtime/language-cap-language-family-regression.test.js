#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

applyTestEnv();

assert.ok(LANGUAGE_CAPS_BASELINES.python.maxLines >= 9000, 'python maxLines should support docstring-heavy modules');
assert.ok(LANGUAGE_CAPS_BASELINES.ruby.maxLines >= 6500, 'ruby maxLines should support DSL-heavy files');
assert.ok(LANGUAGE_CAPS_BASELINES.php.maxLines >= 8500, 'php maxLines should support mixed template monoliths');
assert.ok(LANGUAGE_CAPS_BASELINES.lua.maxLines >= 5500, 'lua maxLines should support table-heavy scripts');
assert.ok(LANGUAGE_CAPS_BASELINES.perl.maxLines >= 9000, 'perl maxLines should support monolithic legacy scripts');
assert.ok(LANGUAGE_CAPS_BASELINES.shell.maxLines >= 5500, 'shell maxLines should support ops script bundles');

assert.ok(LANGUAGE_CAPS_BASELINES.typescript.maxLines > LANGUAGE_CAPS_BASELINES.javascript.maxLines,
  'typescript maxLines should remain independently calibrated above javascript');

console.log('language cap family regression test passed');
