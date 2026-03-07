#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-provider-overrides-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const requestedByProvider = new Map();
const resolveCommandProfile = ({ providerId, cmd, args = [] }) => {
  if (!providerId.includes('-runtime-') && providerId !== 'zig') {
    requestedByProvider.set(providerId, {
      cmd,
      args: Array.isArray(args) ? args.slice() : []
    });
  }
  return {
    requested: { cmd, args },
    resolved: { cmd, args, mode: 'mock', reason: 'test' },
    probe: { ok: true, attempted: [{ args: ['--version'], exitCode: 0 }] }
  };
};

registerDefaultToolingProviders();
const providerIds = [
  'pyright',
  'csharp-ls',
  'dart',
  'elixir-ls',
  'haskell-language-server',
  'phpactor',
  'solargraph'
];
await runToolingDoctor({
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: providerIds,
    pyright: {
      command: 'pyright-custom',
      args: ['--stdio', '--watch']
    },
    csharp: { cmd: 'csharp-custom' },
    dart: { cmd: 'dart-custom' },
    elixir: { cmd: 'elixir-custom' },
    haskell: { cmd: 'hls-custom' },
    phpactor: { cmd: 'phpactor-custom' },
    solargraph: { cmd: 'solargraph-custom' }
  },
  strict: false
}, providerIds, {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

assert.equal(requestedByProvider.get('pyright')?.cmd, 'pyright-custom');
assert.deepEqual(requestedByProvider.get('pyright')?.args, ['--stdio', '--watch']);
assert.equal(requestedByProvider.get('csharp-ls')?.cmd, 'csharp-custom');
assert.equal(requestedByProvider.get('dart')?.cmd, 'dart-custom');
assert.equal(requestedByProvider.get('elixir-ls')?.cmd, 'elixir-custom');
assert.equal(requestedByProvider.get('haskell-language-server')?.cmd, 'hls-custom');
assert.equal(requestedByProvider.get('phpactor')?.cmd, 'phpactor-custom');
assert.equal(requestedByProvider.get('solargraph')?.cmd, 'solargraph-custom');

console.log('tooling doctor provider command override resolution test passed');
