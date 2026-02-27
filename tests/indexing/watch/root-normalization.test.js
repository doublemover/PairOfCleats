#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
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

const symlinkTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-root-symlink-'));
const symlinkRepoRoot = path.join(symlinkTempRoot, 'repo');
const symlinkOutsideRoot = path.join(symlinkTempRoot, 'outside');
await fs.mkdir(symlinkRepoRoot, { recursive: true });
await fs.mkdir(symlinkOutsideRoot, { recursive: true });
await fs.writeFile(path.join(symlinkOutsideRoot, 'external.js'), 'export const x = 1;\n', 'utf8');
const symlinkRecordsRoot = path.join(symlinkRepoRoot, 'records-link');
let symlinkCreated = false;
try {
  await fs.symlink(symlinkOutsideRoot, symlinkRecordsRoot, process.platform === 'win32' ? 'junction' : 'dir');
  symlinkCreated = true;
} catch {}
if (symlinkCreated) {
  const externalViaSymlink = path.join(symlinkRecordsRoot, 'external.js');
  assert.equal(
    resolveRecordsRoot(symlinkRepoRoot, symlinkRecordsRoot),
    null,
    'records root symlink escaping repo root should be rejected'
  );
  assert.equal(
    isIndexablePath({
      absPath: externalViaSymlink,
      root: symlinkRepoRoot,
      recordsRoot: symlinkRecordsRoot,
      ignoreMatcher,
      modes: ['records']
    }),
    false,
    'symlinked file outside canonical root must not be indexable'
  );
}

const aliasTargetRoot = path.join(symlinkTempRoot, 'alias-target');
const aliasRecordsRoot = path.join(aliasTargetRoot, 'records');
await fs.mkdir(aliasRecordsRoot, { recursive: true });
const aliasCodeFile = path.join(aliasTargetRoot, 'src', 'alias.js');
await fs.mkdir(path.dirname(aliasCodeFile), { recursive: true });
await fs.writeFile(aliasCodeFile, 'export const alias = true;\n', 'utf8');
const aliasRootLink = path.join(symlinkTempRoot, 'alias-root-link');
let aliasLinkCreated = false;
try {
  await fs.symlink(aliasTargetRoot, aliasRootLink, process.platform === 'win32' ? 'junction' : 'dir');
  aliasLinkCreated = true;
} catch {}
if (aliasLinkCreated) {
  assert.equal(
    resolveRecordsRoot(aliasRootLink, aliasRecordsRoot),
    normalizeRoot(aliasRecordsRoot),
    'canonical in-root records path should be accepted even when root is an alias path'
  );
  assert.equal(
    isIndexablePath({
      absPath: aliasCodeFile,
      root: aliasRootLink,
      recordsRoot: aliasRecordsRoot,
      ignoreMatcher,
      modes: ['code']
    }),
    true,
    'canonical in-root file should remain indexable when root is an alias path'
  );
}

await fs.rm(symlinkTempRoot, { recursive: true, force: true });

console.log('watch root normalization contract ok.');
