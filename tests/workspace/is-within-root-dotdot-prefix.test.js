#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { isWithinRoot } from '../../src/workspace/identity.js';

const repoRoot = path.resolve('repo-root');
const insideDotDotPrefixed = path.join(repoRoot, '..cache', 'index-state.json');
const outsidePath = path.resolve(repoRoot, '..', 'outside', 'index-state.json');

assert.equal(isWithinRoot(insideDotDotPrefixed, repoRoot), true);
assert.equal(isWithinRoot(outsidePath, repoRoot), false);

console.log('workspace isWithinRoot dotdot-prefix test passed');
