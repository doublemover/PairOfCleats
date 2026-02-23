#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTreeSitterJsCaps } from '../../../src/index/build/runtime/caps.js';

const fileCaps = {
  byExt: {
    '.js': { maxLines: 5200 },
    '.mjs': { maxBytes: 777 },
    '.ts': { maxBytes: 2048 }
  }
};

const applied = applyTreeSitterJsCaps(fileCaps, 123456);
assert.equal(applied, true, 'expected tree-sitter JS caps to apply defaults');
assert.equal(fileCaps.byExt['.js'].maxBytes, 123456, 'expected js maxBytes default');
assert.equal(fileCaps.byExt['.jsx'].maxBytes, 123456, 'expected jsx maxBytes default');
assert.equal(fileCaps.byExt['.cjs'].maxBytes, 123456, 'expected cjs maxBytes default');
assert.equal(fileCaps.byExt['.jsm'].maxBytes, 123456, 'expected jsm maxBytes default');
assert.equal(fileCaps.byExt['.mjs'].maxBytes, 777, 'expected explicit mjs maxBytes to remain unchanged');
assert.equal(fileCaps.byExt['.ts'].maxBytes, 2048, 'expected non-js extension to remain unchanged');

const notApplied = applyTreeSitterJsCaps(fileCaps, 0);
assert.equal(notApplied, false, 'expected non-positive cap values to no-op');

console.log('language cap tree-sitter js defaults test passed');
