#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tooling-doctor-workspace-model-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const providerId = 'lsp-java-dedicated';
const resolveCommandProfile = ({ cmd, args = [] }) => ({
  requested: { cmd, args },
  resolved: { cmd, args, mode: 'direct', source: 'mock' },
  probe: { ok: true, attempted: [{ cmd, args }], resolvedPath: String(cmd) }
});

const runDoctor = async () => runToolingDoctor({
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: [providerId],
    lsp: {
      enabled: true,
      servers: [
        { id: 'java-dedicated', cmd: 'jdtls', languages: ['java'] }
      ]
    }
  },
  strict: false
}, [providerId], {
  log: () => {},
  probeHandshake: false,
  resolveCommandProfile
});

const reportMissingMarkers = await runDoctor();
const javaMissing = (reportMissingMarkers.providers || []).find((entry) => entry.id === providerId);
const missingCheck = (javaMissing?.checks || []).find((check) => check.name === `${providerId}-workspace-model`);
assert.ok(missingCheck, 'expected workspace-model check for jdtls');
assert.equal(missingCheck.status, 'warn', 'expected warn when Java workspace markers are missing');

await fs.writeFile(path.join(tempRoot, 'pom.xml'), '<project/>', 'utf8');
const reportWithMarkers = await runDoctor();
const javaPresent = (reportWithMarkers.providers || []).find((entry) => entry.id === providerId);
const presentCheck = (javaPresent?.checks || []).find((check) => check.name === `${providerId}-workspace-model`);
assert.ok(presentCheck, 'expected workspace-model check after marker creation');
assert.equal(presentCheck.status, 'ok', 'expected ok when Java workspace markers are present');

console.log('tooling doctor workspace model detection test passed');
