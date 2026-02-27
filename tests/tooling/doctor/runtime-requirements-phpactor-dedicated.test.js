#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-runtime-reqs-phpactor-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const shouldResolve = new Set(['phpactor']);
const missingDependencies = new Set(['php']);
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
    enabledTools: ['phpactor']
  },
  strict: false
}, ['phpactor'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'phpactor');
assert.ok(provider, 'expected dedicated phpactor provider report');
const phpRuntimeCheck = (provider.checks || []).find((check) => check.name === 'phpactor-runtime-php');
assert.ok(phpRuntimeCheck, 'expected PHP runtime requirement check');
assert.equal(phpRuntimeCheck.status, 'error', 'expected PHP runtime check error when php command missing');

console.log('tooling doctor dedicated phpactor runtime requirements test passed');
