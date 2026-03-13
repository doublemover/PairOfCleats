#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizeRelPath } from '../../../src/index/build/import-resolution/path-utils.js';

assert.equal(normalizeRelPath(''), '');
assert.equal(normalizeRelPath('.'), '');
assert.equal(normalizeRelPath('./src/app.ts'), 'src/app.ts');
assert.equal(normalizeRelPath('../shared/util.ts'), '../shared/util.ts');
assert.equal(normalizeRelPath('../../pkg/mod.ts'), '../../pkg/mod.ts');
assert.equal(normalizeRelPath('src/../lib/index.ts'), 'lib/index.ts');
assert.equal(normalizeRelPath('C:\\repo\\src\\main.ts').endsWith('repo/src/main.ts'), true);

console.log('import path-utils normalizeRelPath test passed');

