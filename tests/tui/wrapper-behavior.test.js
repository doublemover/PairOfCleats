#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readTargetsManifestSync,
  resolveHostTargetTriple,
  resolveTargetForTriple
} from '../../tools/tui/targets.js';

const root = process.cwd();
const wrapperPath = path.join(root, 'bin', 'pairofcleats-tui.js');
const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-tui-wrapper-'));

const runWrapper = () => spawnSync(process.execPath, [wrapperPath], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    PAIROFCLEATS_TUI_INSTALL_ROOT: tempRoot
  }
});

try {
  const missingManifest = runWrapper();
  assert.notEqual(missingManifest.status, 0);
  assert.match(
    `${missingManifest.stderr || ''}`,
    /missing install manifest/i,
    'expected actionable missing-manifest failure'
  );

  const { targets } = readTargetsManifestSync({ root });
  const triple = resolveHostTargetTriple({ platform: process.platform, arch: os.arch() });
  const target = resolveTargetForTriple(targets, triple);
  assert(target, `missing target for ${triple}`);

  const tripleDir = path.join(tempRoot, triple);
  const binDir = path.join(tripleDir, 'bin');
  await fsPromises.mkdir(binDir, { recursive: true });
  const binaryPath = path.join(binDir, target.artifactName);
  await fsPromises.writeFile(
    binaryPath,
    process.platform === 'win32'
      ? Buffer.from('MZFAKE-TUI-BINARY')
      : '#!/usr/bin/env node\nconsole.log("fake tui");\n',
    'utf8'
  );
  if (process.platform !== 'win32') {
    await fsPromises.chmod(binaryPath, 0o755);
  }

  await fsPromises.writeFile(path.join(tripleDir, 'install-manifest.json'), JSON.stringify({
    schemaVersion: 1,
    triple,
    artifactName: target.artifactName,
    binary: {
      path: path.relative(root, binaryPath).replace(/\\/g, '/'),
      sha256: 'deadbeef',
      sizeBytes: fs.statSync(binaryPath).size,
      executable: true,
      mode: process.platform === 'win32' ? null : 0o755
    },
    observability: {
      eventLogDir: path.relative(root, path.join(tripleDir, 'logs')).replace(/\\/g, '/')
    }
  }), 'utf8');

  const checksumMismatch = runWrapper();
  assert.notEqual(checksumMismatch.status, 0);
  assert.match(
    `${checksumMismatch.stderr || ''}`,
    /checksum mismatch/i,
    'expected checksum mismatch failure'
  );

  console.log('tui wrapper behavior test passed');
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}
