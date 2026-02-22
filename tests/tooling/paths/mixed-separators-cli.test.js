#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizePathForPlatform, normalizeRepoRelativePath } from '../../../src/shared/path-normalize.js';

const winRepoRoot = normalizePathForPlatform('C:/repo-root', { platform: 'win32' });
const winRawCliValue = 'C:/repo-root\\src//nested\\file.js';

const winRepoRelative = normalizeRepoRelativePath(winRawCliValue, winRepoRoot, { stripDot: true });
assert.equal(winRepoRelative, 'src/nested/file.js', 'expected mixed Windows CLI separators to normalize');

const posixRepoRoot = normalizePathForPlatform('/repo-root', { platform: 'posix' });
const posixRawCliValue = '/repo-root\\src//nested\\file.js';
const posixRepoRelative = normalizeRepoRelativePath(posixRawCliValue, posixRepoRoot, { stripDot: true });
assert.equal(posixRepoRelative, 'src/nested/file.js', 'expected mixed POSIX CLI separators to normalize');

const rootRelative = normalizeRepoRelativePath(winRepoRoot, winRepoRoot, { stripDot: true });
assert.equal(rootRelative, '', 'expected repo root path to normalize to empty repo-relative path');

console.log('mixed separators cli test passed');
