#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-runtime-reqs-elixir-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const shouldResolve = new Set(['elixir-ls']);
const missingDependencies = new Set(['elixir', 'erl']);
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
    enabledTools: ['elixir-ls']
  },
  strict: false
}, ['elixir-ls'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'elixir-ls');
assert.ok(provider, 'expected dedicated elixir provider report');
const elixirRuntimeCheck = (provider.checks || []).find((check) => check.name === 'elixir-ls-runtime-elixir');
assert.ok(elixirRuntimeCheck, 'expected elixir runtime requirement check');
assert.equal(elixirRuntimeCheck.status, 'error', 'expected elixir runtime check error when elixir command missing');
const erlRuntimeCheck = (provider.checks || []).find((check) => check.name === 'elixir-ls-runtime-erl');
assert.ok(erlRuntimeCheck, 'expected Erlang runtime requirement check');
assert.equal(erlRuntimeCheck.status, 'error', 'expected Erlang runtime check error when erl command missing');

console.log('tooling doctor dedicated elixir runtime requirements test passed');
