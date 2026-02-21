#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveHostTargetTriple, resolveTargetForTriple, readTargetsManifestSync } from '../../tools/tui/targets.js';

const root = process.cwd();
const distDir = path.join(root, 'dist', 'tui');
const installScript = path.join(root, 'tools', 'tui', 'install.js');
const manifestPath = path.join(distDir, 'tui-artifacts-manifest.json');
const checksumPath = path.join(distDir, 'tui-artifacts-manifest.json.sha256');
const backupPaths = new Map();
const createdPaths = new Set();

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const backupFile = async (filePath) => {
  if (!fs.existsSync(filePath)) return;
  const backupPath = `${filePath}.bak-${process.pid}-${Date.now()}`;
  await fsPromises.rename(filePath, backupPath);
  backupPaths.set(filePath, backupPath);
};

const restoreBackups = async () => {
  for (const [original, backup] of backupPaths.entries()) {
    if (fs.existsSync(original)) {
      await fsPromises.rm(original, { force: true, recursive: true });
    }
    if (fs.existsSync(backup)) {
      await fsPromises.rename(backup, original);
    }
  }
};

const removeCreated = async () => {
  for (const filePath of createdPaths.values()) {
    if (!backupPaths.has(filePath) && fs.existsSync(filePath)) {
      await fsPromises.rm(filePath, { recursive: true, force: true });
    }
  }
};

try {
  await fsPromises.mkdir(distDir, { recursive: true });

  const { targets } = readTargetsManifestSync({ root });
  const triple = resolveHostTargetTriple({ platform: process.platform, arch: os.arch() });
  const target = resolveTargetForTriple(targets, triple);
  assert(target, `expected target in tools/tui/targets.json for ${triple}`);

  const artifactPath = path.join(distDir, target.artifactName);
  await backupFile(artifactPath);
  await backupFile(manifestPath);
  await backupFile(checksumPath);

  await fsPromises.writeFile(
    artifactPath,
    process.platform === 'win32'
      ? Buffer.from('MZFAKE-TUI-BINARY')
      : '#!/usr/bin/env node\nconsole.log("fake tui");\n',
    'utf8'
  );
  if (process.platform !== 'win32') {
    await fsPromises.chmod(artifactPath, 0o755);
  }
  createdPaths.add(artifactPath);

  const manifest = {
    schemaVersion: 1,
    tool: 'pairofcleats-tui',
    mode: 'smoke',
    pathPolicy: 'repo-relative-posix',
    targetsManifest: {
      file: 'tools/tui/targets.json',
      sha256: sha256(fs.readFileSync(path.join(root, 'tools', 'tui', 'targets.json'), 'utf8'))
    },
    artifacts: [
      {
        triple,
        platform: target.platform,
        artifactName: target.artifactName,
        artifactPath: path.relative(root, artifactPath).replace(/\\/g, '/'),
        exists: true,
        sha256: sha256(fs.readFileSync(artifactPath))
      }
    ]
  };
  const manifestBody = `${stableStringify(manifest)}\n`;
  await fsPromises.writeFile(manifestPath, manifestBody, 'utf8');
  await fsPromises.writeFile(
    checksumPath,
    `${sha256(manifestBody)}  ${path.basename(manifestPath)}\n`,
    'utf8'
  );
  createdPaths.add(manifestPath);
  createdPaths.add(checksumPath);

  const installRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tui-install-'));
  const result = spawnSync(
    process.execPath,
    [installScript, '--json', '--target', triple, '--install-root', installRoot],
    { cwd: root, encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr || 'install script exited non-zero');
  const payload = JSON.parse(result.stdout || '{}');
  assert.equal(payload.ok, true);
  assert.equal(payload.triple, triple);
  assert.equal(typeof payload.checksum, 'string');

  const metadataPath = path.join(installRoot, triple, 'install-manifest.json');
  const installedBinary = path.join(installRoot, triple, 'bin', target.artifactName);
  assert.equal(fs.existsSync(metadataPath), true, 'expected install metadata');
  assert.equal(fs.existsSync(installedBinary), true, 'expected installed binary');

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.equal(metadata.triple, triple);
  assert.equal(metadata.artifactName, target.artifactName);

  console.log('tui installer unit test passed');
} finally {
  await removeCreated();
  await restoreBackups();
}
