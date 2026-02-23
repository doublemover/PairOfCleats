#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { toRepoPosixPath } from '../../../src/index/scm/paths.js';

const repoRoot = path.resolve('repo-root');
const insideDotDotPrefixed = path.join(repoRoot, '..metadata', 'file.txt');
const outsidePath = path.resolve(repoRoot, '..', 'outside', 'file.txt');

assert.equal(toRepoPosixPath(insideDotDotPrefixed, repoRoot), '..metadata/file.txt');
assert.equal(toRepoPosixPath('..metadata/file.txt', repoRoot), '..metadata/file.txt');
assert.equal(toRepoPosixPath(outsidePath, repoRoot), null);

console.log('scm paths dotdot-prefix test passed');
