#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stableStringify } from '../../src/shared/stable-json.js';
import { resolveHostTargetTriple, resolveTargetForTriple, readTargetsManifestSync } from '../../tools/tui/targets.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const testDistRel = path.join('.testLogs', 'tui', 'installer-unit', 'dist');
const distDir = path.join(root, testDistRel);
const installScript = path.join(root, 'tools', 'tui', 'install.js');
const manifestPath = path.join(distDir, 'tui-artifacts-manifest.json');
const checksumPath = path.join(distDir, 'tui-artifacts-manifest.json.sha256');
let installRoot = '';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

try {
  await fsPromises.rm(distDir, { recursive: true, force: true });
  await fsPromises.mkdir(distDir, { recursive: true });

  const { targets } = readTargetsManifestSync({ root });
  const triple = resolveHostTargetTriple({ platform: process.platform, arch: os.arch() });
  const target = resolveTargetForTriple(targets, triple);
  assert(target, `expected target in tools/tui/targets.json for ${triple}`);

  const artifactPath = path.join(distDir, target.artifactName);

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

  installRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tui-install-'));
  const result = spawnSync(
    process.execPath,
    [installScript, '--json', '--target', triple, '--install-root', installRoot],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PAIROFCLEATS_TUI_DIST_DIR: testDistRel
      }
    }
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
  await fsPromises.rm(distDir, { recursive: true, force: true });
  if (installRoot) {
    await fsPromises.rm(installRoot, { recursive: true, force: true });
  }
}
