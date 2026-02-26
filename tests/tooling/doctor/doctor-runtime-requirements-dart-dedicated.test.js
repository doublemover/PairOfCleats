#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-runtime-reqs-dart-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const shouldResolve = new Set(['dart']);
const resolveCommandProfile = ({ cmd, args = [] }) => {
  const normalized = String(cmd || '').trim().toLowerCase();
  const ok = shouldResolve.has(normalized) && !(Array.isArray(args) && args.length === 1 && args[0] === '--version');
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
    enabledTools: ['dart']
  },
  strict: false
}, ['dart'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const provider = (report.providers || []).find((entry) => entry.id === 'dart');
assert.ok(provider, 'expected dedicated dart provider report');
const dartRuntimeCheck = (provider.checks || []).find((check) => check.name === 'dart-runtime-dart-sdk');
assert.ok(dartRuntimeCheck, 'expected Dart SDK runtime requirement check');
assert.equal(dartRuntimeCheck.status, 'error', 'expected Dart SDK runtime check error when --version probe fails');

console.log('tooling doctor dedicated dart runtime requirements test passed');
