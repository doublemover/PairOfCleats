#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { findUpwards } from '../../../src/shared/fs/find-upwards.js';

const root = process.cwd();
const outDir = path.join(root, '.testCache', 'find-upwards-contract');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const repoRoot = path.join(outDir, 'repo');
const nested = path.join(repoRoot, 'src', 'deep');
await fsPromises.mkdir(nested, { recursive: true });
await fsPromises.mkdir(path.join(repoRoot, '.git'), { recursive: true });

const foundRoot = findUpwards(
  nested,
  (candidateDir) => fs.existsSync(path.join(candidateDir, '.git'))
);
assert.equal(foundRoot, repoRoot, 'expected to resolve git root from nested start dir');

const stoppedEarly = findUpwards(
  nested,
  () => false,
  path.join(repoRoot, 'src')
);
assert.equal(stoppedEarly, null, 'expected stopDir boundary to stop upward walk');

const symlinkRoot = path.join(outDir, 'repo-link');
let symlinkCreated = false;
try {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  await fsPromises.symlink(repoRoot, symlinkRoot, linkType);
  symlinkCreated = true;
} catch {}

if (symlinkCreated) {
  const visited = [];
  const viaSymlink = findUpwards(
    path.join(symlinkRoot, 'src', 'deep'),
    (candidateDir) => {
      visited.push(path.resolve(candidateDir));
      return false;
    },
    repoRoot
  );
  assert.equal(viaSymlink, null);
  assert.equal(
    visited[visited.length - 1],
    path.resolve(symlinkRoot),
    'expected canonical stopDir to halt at symlinked repo root'
  );
  assert.ok(
    !visited.includes(path.resolve(outDir)),
    'expected no upward walk beyond symlinked repo root'
  );
}

console.log('find-upwards contract ok.');
