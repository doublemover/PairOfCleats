#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeValidateMode } from '../../../../tools/build/sqlite/runner.js';

assert.equal(normalizeValidateMode(false), 'off');
assert.equal(normalizeValidateMode('auto'), 'auto');
assert.equal(normalizeValidateMode('full'), 'full');
assert.equal(normalizeValidateMode('true'), 'smoke');

console.log('sqlite build validate mode normalization test passed');
