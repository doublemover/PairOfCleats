#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { CI_BUNDLE_VERSION, inventoryCiFiles, verifyCiBundleInventory, assertDisjointCiPaths,
  restoreCiArtifactBundle } from '../../../tools/ci/artifact-bundle.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ci-bundle-'));
try {
  await fs.mkdir(path.join(root, 'index-code'));
  await fs.writeFile(path.join(root, 'index-code', 'piece.json'), '[]');
  const manifest = { version: CI_BUNDLE_VERSION, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    files: await inventoryCiFiles(root) };
  await verifyCiBundleInventory(root, manifest);
  assert.throws(() => assertDisjointCiPaths(root, path.join(root, 'child')));
  await fs.writeFile(path.join(root, 'index-code', 'piece.json'), '[1]');
  await assert.rejects(verifyCiBundleInventory(root, manifest), /checksum|size/);
  // Invalid bundles must fail before index lock admission, generation creation or promotion.
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(restoreCiArtifactBundle({ root, userConfig: {}, fromDir: root,
    gitState: { head: 'current' }, force: true }), /checksum|size|overlap/);
  await assert.rejects(verifyCiBundleInventory(root, { ...manifest, version: 3 }), /unsupported/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
