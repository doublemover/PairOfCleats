#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tooling-post-install-verification');
const binDir = path.join(tempRoot, 'bin');
const repoRoot = path.join(tempRoot, 'repo');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(repoRoot);
// This controlled installer returns success without creating an executable.
// It never invokes npm or downloads a package.
const fakeNpm = path.join(binDir, process.platform === 'win32' ? 'npm.cmd' : 'npm');
await fs.writeFile(fakeNpm, process.platform === 'win32' ? '@echo off\r\nexit /b 0\r\n' : '#!/bin/sh\nexit 0\n');
if (process.platform !== 'win32') await fs.chmod(fakeNpm, 0o755);
const env = applyTestEnv({ syncProcess: false, cacheRoot: path.join(tempRoot, 'cache'),
  extraEnv: { PATH: binDir, Path: binDir, PAIROFCLEATS_HOME: path.join(tempRoot, 'resources') } });
const run = (id, extra = []) => {
  const result = runNode([path.join(root, 'tools/tooling/install.js'), '--root', repoRoot,
    '--tools', id, '--scope', 'cache', '--no-fallback', '--json', ...extra],
  `verify installer ${id}`, root, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  return { result, payload: JSON.parse(result.stdout) };
};
const failed = run('pyright');
assert.equal(failed.result.status, 1);
assert.equal(failed.payload.results[0].status, 'verification-failed');
assert.equal(failed.payload.readiness.state, 'blocked');
assert.equal(failed.payload.readiness.ready, false);
assert.deepEqual(failed.payload.readiness.blockedIds, ['pyright']);
assert.equal(failed.payload.readiness.items[0].verificationLevel, null);
const manual = run('clangd');
assert.equal(manual.result.status, 1, 'manual-only requirements cannot masquerade as installed');
assert.equal(manual.payload.readiness.items[0].state, 'manual-action-required');
const unknown = run('unknown-tool-fixture,unknown-tool-fixture');
assert.equal(unknown.result.status, 1);
assert.deepEqual(unknown.payload.readiness.blockedIds, ['unknown-tool-fixture']);
const planned = run('pyright', ['--dry-run']);
assert.equal(planned.result.status, 0);
assert.equal(planned.payload.readiness.state, 'planned');
assert.equal(planned.payload.readiness.ready, false, 'planning does not prove installation');
console.log('Installer verifies actual executable/layout after process success and reports manual/dry-run states truthfully.');
