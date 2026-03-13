#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { formatGitFailure, resolveRepoEntry } from '../../../tools/service/repos.js';

assert.equal(
  formatGitFailure({ status: null, signal: 'SIGINT', stderr: '', stdout: '' }, 'fallback'),
  'git interrupted by signal SIGINT'
);
assert.equal(
  formatGitFailure({ status: null, signal: null, error: { message: 'spawn ENOENT' } }, 'fallback'),
  'spawn ENOENT'
);
assert.equal(
  formatGitFailure({ status: 1, signal: null, stderr: 'fatal: bad ref' }, 'fallback'),
  'fatal: bad ref'
);
assert.equal(
  formatGitFailure({ status: 1, signal: null, stderr: '', stdout: '' }, 'fallback'),
  'fallback (exit 1)'
);
assert.equal(
  formatGitFailure({ status: 1, signal: null, stderr: 'fatal: bad ref\n', stdout: '' }, 'fallback'),
  'fatal: bad ref'
);

if (process.platform === 'win32') {
  const repoEntries = [
    { id: 'sample', path: path.join('C:', 'Temp', 'Repo-A') }
  ];
  const resolved = resolveRepoEntry(
    path.join('c:', 'temp', 'repo-a'),
    repoEntries,
    process.cwd()
  );
  assert.equal(resolved?.id, 'sample', 'expected resolveRepoEntry to match Windows paths case-insensitively');
}

console.log('service repos failure reason test passed');
