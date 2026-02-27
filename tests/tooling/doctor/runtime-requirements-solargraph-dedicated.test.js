#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-runtime-reqs-solargraph-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const shouldResolve = new Set(['solargraph']);
const missingDependencies = new Set(['ruby', 'gem']);
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
    enabledTools: ['solargraph']
  },
  strict: false
}, ['solargraph'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'solargraph');
assert.ok(provider, 'expected dedicated solargraph provider report');
const rubyRuntimeCheck = (provider.checks || []).find((check) => check.name === 'solargraph-runtime-ruby');
assert.ok(rubyRuntimeCheck, 'expected Ruby runtime requirement check');
assert.equal(rubyRuntimeCheck.status, 'error', 'expected Ruby runtime check error when ruby command missing');
const gemRuntimeCheck = (provider.checks || []).find((check) => check.name === 'solargraph-runtime-gem');
assert.ok(gemRuntimeCheck, 'expected RubyGems runtime requirement check');
assert.equal(gemRuntimeCheck.status, 'error', 'expected RubyGems runtime check error when gem command missing');

console.log('tooling doctor dedicated solargraph runtime requirements test passed');
