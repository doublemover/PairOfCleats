#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeImportPath } from '../../src/graph/indexes.js';
import { toPosix } from '../../src/shared/files.js';

const repoRoot = path.resolve('repo-root');
const insideDotDotPrefixed = path.join(repoRoot, '..config', 'hooks.js');
const outsidePath = path.resolve(repoRoot, '..', 'outside', 'hooks.js');

assert.equal(normalizeImportPath(insideDotDotPrefixed, repoRoot), '..config/hooks.js');
assert.equal(normalizeImportPath(outsidePath, repoRoot), toPosix(outsidePath));

console.log('graph normalize import path dotdot-prefix test passed');
