#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { normalizeRoot } from '../../../src/index/build/watch/shared.js';
import { resolveRecordsRoot } from '../../../src/index/build/watch/records.js';
import { isIndexablePath } from '../../../src/index/build/watch/guardrails.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), 'watch-root-normalization');
const recordsRoot = path.join(root, 'Records');
const nestedRecord = path.join(recordsRoot, 'note.md');

const normalizedRoot = normalizeRoot(root);
const normalizedRecords = normalizeRoot(recordsRoot);

if (process.platform === 'win32') {
  assert.equal(normalizedRoot, path.resolve(root).toLowerCase());
} else {
  assert.equal(normalizedRoot, path.resolve(root));
}

assert.equal(resolveRecordsRoot(root, recordsRoot), normalizedRecords);
assert.equal(resolveRecordsRoot(root, path.resolve(root, '..', 'outside')), null);

const ignoreMatcher = { ignores: () => false };
assert.equal(
  isIndexablePath({
    absPath: nestedRecord,
    root,
    recordsRoot,
    ignoreMatcher,
    modes: ['records']
  }),
  true
);
assert.equal(
  isIndexablePath({
    absPath: nestedRecord,
    root,
    recordsRoot,
    ignoreMatcher,
    modes: ['code']
  }),
  false
);

console.log('watch root normalization contract ok.');
