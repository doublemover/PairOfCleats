#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-provider-requires-args-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const calls = [];
const resolveCommandProfile = ({ cmd, args = [] }) => {
  calls.push({ cmd, args: Array.isArray(args) ? args.slice() : [] });
  return {
    requested: { cmd, args },
    resolved: { cmd, args, mode: 'mock', reason: 'test' },
    probe: { ok: true, attempted: [{ cmd, args }] }
  };
};

registerDefaultToolingProviders();
await runToolingDoctor({
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['solargraph', 'phpactor']
  },
  strict: false
}, ['solargraph', 'phpactor'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const solargraphCalls = calls.filter((entry) => entry.cmd === 'solargraph');
assert.ok(solargraphCalls.length > 0, 'expected solargraph command probe');
assert.equal(
  solargraphCalls.some((entry) => entry.args.length === 1 && entry.args[0] === 'stdio'),
  true,
  'expected doctor to pass provider requires.args to command profile resolver'
);
const phpactorCalls = calls.filter((entry) => entry.cmd === 'phpactor');
assert.ok(phpactorCalls.length > 0, 'expected phpactor command probe');
assert.equal(
  phpactorCalls.some((entry) => entry.args.length === 1 && entry.args[0] === 'language-server'),
  true,
  'expected doctor to pass phpactor requires.args to command profile resolver'
);

console.log('tooling doctor provider requires args test passed');
