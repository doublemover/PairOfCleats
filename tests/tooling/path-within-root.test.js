#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { isPathWithinRoot } from '../../tools/shared/path-within-root.js';

const root = path.resolve('tmp-root', 'cache');
const child = path.join(root, 'builds', 'run-1');
const siblingPrefix = `${root}x${path.sep}builds`;

assert.equal(isPathWithinRoot(root, root), true, 'expected root to contain itself');
assert.equal(isPathWithinRoot(child, root), true, 'expected child path to be within root');
assert.equal(isPathWithinRoot(siblingPrefix, root), false, 'expected sibling prefix path to be outside root');

const rootUpper = root.toUpperCase();
const childLower = child.toLowerCase();
assert.equal(
  isPathWithinRoot(childLower, rootUpper, { platform: 'win32' }),
  true,
  'expected win32 mode to compare paths case-insensitively'
);
assert.equal(
  isPathWithinRoot(siblingPrefix.toUpperCase(), rootLower(root), { platform: 'win32' }),
  false,
  'expected win32 mode to preserve boundary checks'
);
assert.equal(
  isPathWithinRoot('C:\\Repo\\src\\index.js', 'c:\\repo', { platform: 'win32' }),
  true,
  'expected win32 mode to normalize and compare Windows separators on non-win hosts'
);
assert.equal(
  isPathWithinRoot('C:\\RepoX\\src\\index.js', 'c:\\repo', { platform: 'win32' }),
  false,
  'expected win32 mode boundary checks to reject sibling prefixes'
);

assert.equal(isPathWithinRoot('', root), false, 'expected empty candidate path to be rejected');
assert.equal(isPathWithinRoot(child, ''), false, 'expected empty root path to be rejected');

console.log('path-within-root helper test passed');

function rootLower(value) {
  return String(value || '').toLowerCase();
}
