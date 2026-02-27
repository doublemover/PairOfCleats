#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-workspace-phpactor-${process.pid}-${Date.now()}`);
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
    enabledTools: ['phpactor']
  },
  strict: false
}, ['phpactor'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

registerDefaultToolingProviders();
const reportMissingMarkers = await runDoctor();
const providerMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'phpactor');
const missingCheck = (providerMissing?.checks || []).find((check) => check.name === 'phpactor-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for phpactor provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when PHP workspace markers are missing');

await fs.writeFile(path.join(tempRoot, 'composer.json'), '{"name":"fixture/php"}\n', 'utf8');
const reportWithMarkers = await runDoctor();
const providerPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'phpactor');
const presentCheck = (providerPresent?.checks || []).find((check) => check.name === 'phpactor-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when PHP workspace markers are present');

console.log('tooling doctor workspace model phpactor detection test passed');
