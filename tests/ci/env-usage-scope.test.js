import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findEnvUsageViolations } from '../../tools/ci/check-env-usage.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-env-usage-'));
try {
  const access = 'process.env.' + 'PAIROFCLEATS_TESTING';
  for (const file of ['src/shared/env.js', 'src/invalid.js', 'tools/invalid.js',
    'temp/old-checkout/src/invalid.js', '.testLogs/probe.js', 'node_modules/pkg/index.js']) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), access);
  }
  const violations = await findEnvUsageViolations(root);
  assert.deepEqual(violations.map(row => row.file).sort(), ['src/invalid.js', 'tools/invalid.js']);
  assert.ok(violations.every(row => row.vars[0] === access));
  console.log('env usage excludes historical workspaces and still rejects source violations');
} finally { await fs.rm(root, { recursive: true, force: true }); }
