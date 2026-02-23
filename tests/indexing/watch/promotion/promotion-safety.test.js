#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { promoteBuild } from '../../../../src/index/build/promotion.js';
import { getBuildsRoot, getCurrentBuildInfo, getRepoCacheRoot } from '../../../../tools/shared/dict-utils.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-promotion-'));
applyTestEnv({ cacheRoot: tempRoot });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });
const userConfig = {};
const swapCase = (value) => String(value).replace(/[A-Za-z]/g, (ch) => (
  ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()
));
const normalizePath = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const outsideRoot = path.join(tempRoot, 'outside');
await fs.mkdir(outsideRoot, { recursive: true });

await assert.rejects(
  () => promoteBuild({
    repoRoot,
    userConfig,
    buildId: 'bad-build',
    buildRoot: outsideRoot,
    modes: ['code']
  }),
  /escapes repo cache root/
);

const buildsRoot = getBuildsRoot(repoRoot, userConfig);
await fs.mkdir(buildsRoot, { recursive: true });
const currentPath = path.join(buildsRoot, 'current.json');
const symlinkEscapeRoot = path.join(buildsRoot, 'escape-link');
let symlinkCreated = false;
try {
  await fs.symlink(outsideRoot, symlinkEscapeRoot, process.platform === 'win32' ? 'junction' : 'dir');
  symlinkCreated = true;
} catch {}
if (symlinkCreated) {
  await assert.rejects(
    () => promoteBuild({
      repoRoot,
      userConfig,
      buildId: 'bad-build-link',
      buildRoot: symlinkEscapeRoot,
      modes: ['code']
    }),
    /escapes repo cache root/
  );

  await fs.writeFile(currentPath, JSON.stringify({
    buildId: 'unsafe-link',
    buildRoot: 'builds/escape-link'
  }, null, 2));
  const symlinkInfo = getCurrentBuildInfo(repoRoot, userConfig);
  assert.equal(symlinkInfo, null, 'expected symlinked current.json root to be rejected');
}
if (process.platform === 'win32') {
  const caseBuildId = 'case-sensitive-root-normalized';
  const canonicalCaseRoot = path.join(buildsRoot, caseBuildId);
  await fs.mkdir(canonicalCaseRoot, { recursive: true });
  const mixedCaseRoot = swapCase(canonicalCaseRoot);
  await assert.doesNotReject(
    () => promoteBuild({
      repoRoot,
      userConfig,
      buildId: caseBuildId,
      buildRoot: mixedCaseRoot,
      modes: ['code']
    }),
    'expected promoteBuild to accept mixed-case windows path under repo cache root'
  );
  const promoted = getCurrentBuildInfo(repoRoot, userConfig);
  assert.equal(promoted?.buildId, caseBuildId, 'expected mixed-case promotion to be accepted');
  assert.equal(
    normalizePath(promoted?.buildRoot || ''),
    normalizePath(canonicalCaseRoot),
    'expected promoted buildRoot to resolve to canonical build path'
  );
}
const unsafeRoot = path.join(repoCacheRoot, '..', '..', 'outside');
await fs.writeFile(currentPath, JSON.stringify({
  buildId: 'unsafe-build',
  buildRoot: unsafeRoot
}, null, 2));

const info = getCurrentBuildInfo(repoRoot, userConfig);
assert.equal(info, null, 'expected unsafe current.json to be rejected');

console.log('promotion safety tests passed');
