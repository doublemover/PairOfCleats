#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatGitFailure } from '../../../tools/service/repos.js';

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
  'fallback'
);

console.log('service repos failure reason test passed');
