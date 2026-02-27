#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-runtime-reqs-haskell-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const shouldResolve = new Set(['haskell-language-server']);
const missingDependencies = new Set(['ghc']);
const resolveCommandProfile = ({ cmd, args = [] }) => {
  const normalized = String(cmd || '').trim().toLowerCase();
  const ok = shouldResolve.has(normalized) || !missingDependencies.has(normalized);
  return {
    requested: { cmd, args },
    resolved: {
      cmd,
      args,
      mode: 'direct',
      source: 'mock'
    },
    probe: {
      ok,
      attempted: [{ cmd, args }],
      resolvedPath: ok ? String(cmd) : null
    }
  };
};

registerDefaultToolingProviders();
const report = await runToolingDoctor({
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['haskell-language-server']
  },
  strict: false
}, ['haskell-language-server'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'haskell-language-server');
assert.ok(provider, 'expected dedicated haskell provider report');
const ghcRuntimeCheck = (provider.checks || []).find((check) => check.name === 'haskell-language-server-runtime-ghc');
assert.ok(ghcRuntimeCheck, 'expected GHC runtime requirement check');
assert.equal(ghcRuntimeCheck.status, 'error', 'expected GHC runtime check error when ghc command missing');

console.log('tooling doctor dedicated haskell runtime requirements test passed');
