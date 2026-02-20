#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildNonInteractiveGitEnv,
  ensureRepoBenchmarkReady,
  parseSubmoduleStatusLines
} from '../../../tools/bench/language/repos.js';

const parsed = parseSubmoduleStatusLines([
  '-a1b2c3d extern/doctest (heads/main)',
  ' f0f0f0f include/fmt',
  '+1234567 third_party/json (v3.11.0)',
  'U89abcde bad/submodule (merge conflict)'
].join('\n'));

assert.equal(parsed.length, 4, 'expected four parsed submodule status entries');
assert.deepEqual(
  parsed.map((entry) => ({
    marker: entry.marker,
    path: entry.path,
    missing: entry.missing,
    dirty: entry.dirty
  })),
  [
    { marker: '-', path: 'extern/doctest', missing: true, dirty: false },
    { marker: ' ', path: 'include/fmt', missing: false, dirty: false },
    { marker: '+', path: 'third_party/json', missing: false, dirty: true },
    { marker: 'U', path: 'bad/submodule', missing: false, dirty: true }
  ],
  'expected parser to retain marker semantics used for preflight decisions'
);

const tempRoot = path.join(process.cwd(), '.testCache', 'bench-language-repo-preflight');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
const missingRepo = path.join(tempRoot, 'missing-repo');

const summary = ensureRepoBenchmarkReady({ repoPath: missingRepo });
assert.equal(summary.gitRepo, false, 'expected non-git dirs to skip preflight without throwing');
assert.equal(summary.submodules.detected, 0, 'unexpected submodule detection for non-git dir');
assert.equal(summary.lfs.pulled, false, 'unexpected lfs pull for non-git dir');

const env = buildNonInteractiveGitEnv({ HOME: '/tmp/home' });
assert.equal(env.GIT_TERMINAL_PROMPT, '0', 'expected bench preflight git commands to disable prompts');
assert.equal(env.GCM_INTERACTIVE, 'Never', 'expected bench preflight to disable interactive credential manager');
assert.equal(env.HOME, '/tmp/home', 'expected caller env vars to remain intact');

console.log('bench-language repo preflight parser test passed.');
