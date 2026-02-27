#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-workspace-elixir-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const resolveCommandProfile = ({ cmd, args = [] }) => ({
  requested: { cmd, args },
  resolved: { cmd, args, mode: 'direct', source: 'mock' },
  probe: { ok: true, attempted: [{ cmd, args }], resolvedPath: String(cmd) }
});

const runDoctor = async () => runToolingDoctor({
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

registerDefaultToolingProviders();
const reportMissingMarkers = await runDoctor();
const elixirMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'elixir-ls');
const missingCheck = (elixirMissing?.checks || []).find((check) => check.name === 'elixir-ls-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for elixir-ls');
assert.equal(missingCheck.status, 'warn', 'expected warn when Elixir workspace markers are missing');

await fs.writeFile(path.join(tempRoot, 'mix.exs'), 'defmodule Sample.MixProject do\nend\n', 'utf8');
const reportWithMarkers = await runDoctor();
const elixirPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'elixir-ls');
const presentCheck = (elixirPresent?.checks || []).find((check) => check.name === 'elixir-ls-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Elixir workspace markers are present');

console.log('tooling doctor workspace model elixir detection test passed');
