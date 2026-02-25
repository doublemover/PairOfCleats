#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  __setGitCommandRunnerForTests,
  buildNonInteractiveGitEnv,
  ensureRepoBenchmarkReady,
  parseSubmoduleStatusLines
} from '../../../tools/bench/language/repos.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

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

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-language-repo-preflight');
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

const setupMockRepo = async (name, gitmodulesContent) => {
  const repoPath = path.join(tempRoot, name);
  await fs.mkdir(repoPath, { recursive: true });
  if (typeof gitmodulesContent === 'string') {
    await fs.writeFile(path.join(repoPath, '.gitmodules'), gitmodulesContent, 'utf8');
  }
  return repoPath;
};

const withMockGitRunner = (runner, action) => {
  __setGitCommandRunnerForTests(runner);
  try {
    return action();
  } finally {
    __setGitCommandRunnerForTests(null);
  }
};

const sshRepoPath = await setupMockRepo(
  'ssh-rewrite',
  [
    '[submodule "vendor/nvmrc"]',
    '  path = vendor/nvmrc',
    '  url = git@github.com:nvm-sh/nvmrc.git'
  ].join('\n')
);
const sshCalls = [];
const sshLogs = [];
let sshStatusChecks = 0;
const sshSummary = withMockGitRunner((cmd, args) => {
  sshCalls.push([cmd, args]);
  assert.equal(cmd, 'git', 'expected git command for preflight');
  if (args[0] === '--version') {
    return { ok: true, status: 0, stdout: 'git version 2.49.0\n', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === sshRepoPath && args[2] === 'rev-parse') {
    return { ok: true, status: 0, stdout: 'true\n', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === sshRepoPath && args[2] === 'submodule' && args[3] === 'status') {
    sshStatusChecks += 1;
    if (sshStatusChecks === 1) {
      return { ok: true, status: 0, stdout: '-1234567 vendor/nvmrc\n', stderr: '' };
    }
    return { ok: true, status: 0, stdout: '-1234567 vendor/nvmrc\n', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === sshRepoPath && args[2] === 'submodule' && args[3] === 'sync') {
    return { ok: true, status: 0, stdout: '', stderr: '' };
  }
  if (
    args[0] === '-C'
    && args[1] === sshRepoPath
    && args[2] === '-c'
    && args[3] === 'url.https://github.com/.insteadOf=git@github.com:'
    && args[4] === 'submodule'
    && args[5] === 'update'
  ) {
    return {
      ok: false,
      status: 128,
      stdout: 'Cloning into \'vendor/nvmrc\'...\n',
      stderr: [
        'Host key verification failed.',
        'fatal: Could not read from remote repository.'
      ].join('\n')
    };
  }
  throw new Error(`unexpected git invocation: ${JSON.stringify(args)}`);
}, () => ensureRepoBenchmarkReady({
  repoPath: sshRepoPath,
  onLog: (message) => sshLogs.push(String(message || ''))
}));

assert.equal(sshSummary.ok, false, 'expected failing submodule init to fail preflight');
assert.equal(sshSummary.failureReason, 'preflight-submodule-init', 'expected init failure reason');
assert.equal(sshSummary.submodules.rewriteGithubSshToHttps, true, 'expected SSH rewrite marker');
assert.match(sshSummary.failureDetail || '', /Host key verification failed\./, 'expected stderr detail tail');
assert.match(
  sshSummary.failureDetail || '',
  /Could not read from remote repository\./,
  'expected tail detail to include meaningful fatal line'
);
assert.ok(
  sshCalls.some(([, args]) => args.includes('url.https://github.com/.insteadOf=git@github.com:')),
  'expected submodule update to inject HTTPS rewrite config'
);
assert.ok(
  sshLogs.some((line) => line.includes('submodule init failed')),
  'expected submodule init failure to be logged'
);

const verifyRepoPath = await setupMockRepo(
  'verify-missing',
  [
    '[submodule "deps/example"]',
    '  path = deps/example',
    '  url = https://github.com/example/example.git'
  ].join('\n')
);
let verifyStatusChecks = 0;
const verifySummary = withMockGitRunner((cmd, args) => {
  assert.equal(cmd, 'git', 'expected git command for preflight');
  if (args[0] === '--version') {
    return { ok: true, status: 0, stdout: 'git version 2.49.0\n', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === verifyRepoPath && args[2] === 'rev-parse') {
    return { ok: true, status: 0, stdout: 'true\n', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === verifyRepoPath && args[2] === 'submodule' && args[3] === 'status') {
    verifyStatusChecks += 1;
    if (verifyStatusChecks === 1) {
      return { ok: true, status: 0, stdout: '-89abcde deps/example\n', stderr: '' };
    }
    return { ok: true, status: 0, stdout: '-89abcde deps/example\n', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === verifyRepoPath && args[2] === 'submodule' && args[3] === 'sync') {
    return { ok: true, status: 0, stdout: '', stderr: '' };
  }
  if (args[0] === '-C' && args[1] === verifyRepoPath && args[2] === 'submodule' && args[3] === 'update') {
    return { ok: true, status: 0, stdout: '', stderr: '' };
  }
  throw new Error(`unexpected git invocation: ${JSON.stringify(args)}`);
}, () => ensureRepoBenchmarkReady({ repoPath: verifyRepoPath }));

assert.equal(verifySummary.ok, false, 'expected unresolved submodules to fail preflight');
assert.equal(
  verifySummary.failureReason,
  'preflight-submodule-incomplete',
  'expected post-update missing submodules to fail verification'
);
assert.equal(verifySummary.submodules.initialMissing, 1, 'expected one missing submodule before update');
assert.equal(verifySummary.submodules.missing, 1, 'expected one missing submodule after update');
assert.equal(verifySummary.submodules.updated, false, 'expected update flag to remain false on incomplete state');

console.log('bench-language repo preflight parser test passed.');
