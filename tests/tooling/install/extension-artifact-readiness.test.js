#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { verifyVectorExtensionArtifact } from '../../../tools/sqlite/extension-trust.js';
import { buildSetupReadiness } from '../../../tools/setup/readiness.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-extension-readiness-'));
const file = path.join(root, 'fixture-artifact');
const bytes = Buffer.from('controlled fixture bytes; never native-loaded');
const digest = createHash('sha256').update(bytes).digest('hex');
const config = { dir: root, trustedBinarySha256: digest };
const readiness = (verification, required = false) => buildSetupReadiness({
  steps: { extensions: { skipped: false, ...verification } }, errors: []
}, { requiredIds: required ? ['extensions'] : [] });
try {
  const missing = verifyVectorExtensionArtifact(file, config);
  assert.equal(missing.state, 'missing', 'a resolvable target is not an installed artifact');
  assert.equal(missing.present, false);
  assert.equal(readiness(missing).state, 'degraded');
  assert.equal(readiness(missing, true).exitCode, 1);
  await fs.mkdir(file);
  assert.equal(verifyVectorExtensionArtifact(file, config).ok, false, 'a directory is not a native artifact');
  await fs.rm(file, { recursive: true });
  await fs.writeFile(file, '');
  assert.equal(verifyVectorExtensionArtifact(file, config).ok, false, 'empty output is not ready');
  await fs.writeFile(file, bytes);
  const valid = verifyVectorExtensionArtifact(file, config);
  assert.equal(valid.ok, true);
  assert.equal(valid.sha256, digest);
  assert.equal(readiness(valid, true).state, 'ready');
  assert.equal(readiness(valid, true).items[0].verificationLevel, 'artifact-existence-and-approved-integrity');
  const unapproved = verifyVectorExtensionArtifact(file, { dir: root });
  assert.equal(unapproved.ok, false, 'file presence alone cannot bypass the existing source policy');
  const damaged = verifyVectorExtensionArtifact(file, { ...config, trustedBinarySha256: '0'.repeat(64) });
  assert.equal(damaged.state, 'failed');
  assert.match(readiness(damaged).items[0].reason, /checksum mismatch/);

  const registered = { dir: root, provider: 'fixture', filename: 'fixture-artifact',
    platform: process.platform, arch: process.arch, platformKey: `${process.platform}-${process.arch}`,
    downloads: { [`${process.platform}-${process.arch}`]: { url: 'https://example.invalid/fixture', sha256: digest } } };
  await fs.writeFile(path.join(root, 'extensions.json'), JSON.stringify({
    [`fixture:${registered.platformKey}`]: { verified: true, url: 'https://example.invalid/fixture',
      sha256: digest, outputSha256: digest, provider: 'fixture', platform: process.platform,
      arch: process.arch, outputPath: 'fixture-artifact' }
  }));
  assert.equal(verifyVectorExtensionArtifact(file, registered).ok, true, 'actual registration and bytes are verified without loading');
  await fs.writeFile(file, 'changed controlled bytes');
  assert.equal(verifyVectorExtensionArtifact(file, registered).ok, false, 'changed installed bytes fail the same check');
  console.log('Extension readiness checks actual nonempty registered bytes, preserves strict/optional policy, and never loads native code.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
