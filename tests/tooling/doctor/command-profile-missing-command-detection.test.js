#!/usr/bin/env node
import assert from 'node:assert/strict';
import { isProbeCommandDefinitelyMissing } from '../../../src/index/tooling/command-resolver.js';

const missingByErrno = {
  attempted: [
    { args: ['--help'], errorCode: 'ENOENT', stderr: '', stdout: '', exitCode: null }
  ]
};
assert.equal(
  isProbeCommandDefinitelyMissing(missingByErrno),
  true,
  'ENOENT probe attempts should be treated as definitely missing command'
);

const missingByShellText = {
  attempted: [
    {
      args: ['--version'],
      exitCode: 127,
      stderr: 'bash: sourcekit-lsp: command not found',
      stdout: '',
      errorCode: null
    }
  ]
};
assert.equal(
  isProbeCommandDefinitelyMissing(missingByShellText),
  true,
  'shell command-not-found probe output should be treated as definitely missing command'
);

const inconclusiveProbe = {
  attempted: [
    {
      args: ['--help'],
      exitCode: 1,
      stderr: 'usage: sourcekit-lsp [options]',
      stdout: '',
      errorCode: null
    }
  ]
};
assert.equal(
  isProbeCommandDefinitelyMissing(inconclusiveProbe),
  false,
  'non-missing probe failures should remain inconclusive'
);

const mixedProbe = {
  attempted: [
    { args: ['--version'], errorCode: 'ENOENT', stderr: '', stdout: '', exitCode: null },
    {
      args: ['--help'],
      exitCode: 1,
      stderr: 'usage: sourcekit-lsp [options]',
      stdout: '',
      errorCode: null
    }
  ]
};
assert.equal(
  isProbeCommandDefinitelyMissing(mixedProbe),
  false,
  'mixed missing + non-missing failures should stay inconclusive'
);

console.log('command-profile missing-command detection test passed');
