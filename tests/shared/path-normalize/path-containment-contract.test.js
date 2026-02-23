#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { isPathUnderDir } from '../../../src/shared/path-normalize.js';
import { isInside } from '../../../tools/shared/path-utils.js';

const repoRoot = path.resolve('repo-root');
const nestedPath = path.join(repoRoot, 'src', 'main.js');
const normalizedNestedPath = path.join(repoRoot, 'src', '..', 'src', 'main.js');
const dotDotPrefixedPath = path.join(repoRoot, '..cache', 'main.js');
const outsidePath = path.resolve(repoRoot, '..', 'outside', 'main.js');

assert.equal(isPathUnderDir(repoRoot, repoRoot), true);
assert.equal(isPathUnderDir(repoRoot, nestedPath), true);
assert.equal(isPathUnderDir(repoRoot, normalizedNestedPath), true);
assert.equal(isPathUnderDir(repoRoot, dotDotPrefixedPath), true);
assert.equal(isPathUnderDir(repoRoot, outsidePath), false);
assert.equal(isPathUnderDir('', nestedPath), false);
assert.equal(isPathUnderDir(repoRoot, ''), false);

assert.equal(isInside(repoRoot, nestedPath), true);
assert.equal(isInside(repoRoot, outsidePath), false);

console.log('path containment contract ok.');
