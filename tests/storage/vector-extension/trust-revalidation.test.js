#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadVectorExtension } from '../../../tools/sqlite/vector-extension.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir } = await prepareIsolatedTestCacheDir('vector-extension-trust-revalidation');
const file = path.join(dir, 'inert-extension.bin');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = 'ordinary inert fixture bytes';
const config = { enabled: true, path: file, provider: 'sqlite-vec', trustedBinarySha256: hash(bytes) };
let loads = 0;
const db = { loadExtension() { loads++; } };
try {
  assert.equal(loadVectorExtension(db, config).ok, false, 'a missing artifact is repairable');
  await fs.writeFile(file, bytes);
  assert.equal(loadVectorExtension(db, config).ok, true);
  assert.equal(loadVectorExtension(db, config).ok, true);
  assert.equal(loads, 1);
  assert.equal(loadVectorExtension(db, { ...config, trustedBinarySha256: '0'.repeat(64) }).ok, false,
    'a cached load cannot authorize a revoked digest');
  assert.equal(loadVectorExtension(db, config).ok, true, 'a failed policy check does not poison recovery');
  await fs.writeFile(file, 'new approved bytes');
  const changed = loadVectorExtension(db, { ...config, trustedBinarySha256: hash('new approved bytes') });
  assert.equal(changed.ok, false);
  assert.match(changed.reason, /reopen/i, 'changed loaded bytes require a fresh connection');
  assert.equal(loads, 1);
  const freshDb = { loadExtension() { loads++; } };
  assert.equal(loadVectorExtension(freshDb, { ...config, trustedBinarySha256: hash('new approved bytes') }).ok, true);

  const env = { ...process.env };
  delete env.PAIROFCLEATS_TRUSTED_CONFIG;
  for (const [digest, expectedStatus] of [[hash('new approved bytes'), 0], ['0'.repeat(64), 1]]) {
    const result = spawnSync(process.execPath, ['tools/sqlite/verify-extensions.js', '--repo', dir,
      '--path', file, '--sha256', digest, '--json', '--no-load'], {
      cwd: process.cwd(), env, encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, expectedStatus, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.exists, true);
    assert.equal(payload.verification.ok, expectedStatus === 0);
    assert.equal(payload.load.attempted, false, 'integrity verification never loads the inert bytes');
    if (!expectedStatus) assert.equal(payload.verification.verificationLevel, 'artifact-existence-and-approved-integrity');
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Vector trust revocation, repaired failures and no-load CLI integrity passed.');
