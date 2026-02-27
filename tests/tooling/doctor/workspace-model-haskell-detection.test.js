#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-workspace-haskell-${process.pid}-${Date.now()}`);
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
    enabledTools: ['haskell-language-server']
  },
  strict: false
}, ['haskell-language-server'], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

registerDefaultToolingProviders();
const reportMissingMarkers = await runDoctor();
const haskellMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === 'haskell-language-server');
const missingCheck = (haskellMissing?.checks || []).find((check) => check.name === 'haskell-language-server-workspace-model');
assert.ok(missingCheck, 'expected workspace-model check for haskell provider');
assert.equal(missingCheck.status, 'warn', 'expected warn when Haskell workspace markers are missing');

await fs.writeFile(path.join(tempRoot, 'stack.yaml'), 'resolver: lts-22.0\n', 'utf8');
const reportWithMarkers = await runDoctor();
const haskellPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === 'haskell-language-server');
const presentCheck = (haskellPresent?.checks || []).find((check) => check.name === 'haskell-language-server-workspace-model');
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Haskell workspace markers are present');

console.log('tooling doctor workspace model haskell detection test passed');
