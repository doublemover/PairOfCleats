#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizePathForPlatform, normalizeRepoRelativePath } from '../../../src/shared/path-normalize.js';

const repoRoot = normalizePathForPlatform('C:/repo-root', { platform: 'win32' });
const rawCliValue = 'C:/repo-root\\src//nested\\file.js';

const repoRelative = normalizeRepoRelativePath(rawCliValue, repoRoot, { stripDot: true });
assert.equal(repoRelative, 'src/nested/file.js', 'expected mixed CLI separators to normalize to stable repo-relative path');

const rootRelative = normalizeRepoRelativePath(repoRoot, repoRoot, { stripDot: true });
assert.equal(rootRelative, '', 'expected repo root path to normalize to empty repo-relative path');

console.log('mixed separators cli test passed');
