#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  collectEntryFileSet,
  createFileLookup
} from '../../../src/index/build/import-resolution/lookup.js';

const root = process.cwd();
const sampleAbs = path.join(root, 'src', 'index.js');

const malformedCollected = collectEntryFileSet({
  entries: { abs: sampleAbs, rel: 'src/index.js' },
  root
});
assert.equal(malformedCollected.fileSet.size, 0, 'non-iterable entries should be ignored safely');

const iterableCollected = collectEntryFileSet({
  entries: new Set([{ abs: sampleAbs, rel: 'src/index.js' }]),
  root
});
assert.ok(iterableCollected.fileSet.has('src/index.js'), 'iterable entries should still be collected');

const lookupFromMalformed = createFileLookup({
  entries: { abs: sampleAbs, rel: 'src/index.js' },
  root
});
assert.equal(lookupFromMalformed.fileSet.size, 0, 'createFileLookup should tolerate malformed entries');

const lookupFromIterable = createFileLookup({
  entries: new Set([{ abs: sampleAbs, rel: 'src/index.js' }]),
  root
});
assert.ok(lookupFromIterable.fileSet.has('src/index.js'));

console.log('import-resolution lookup shape guard test passed');
