#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

ensureTestingEnv(process.env);

const root = process.cwd();
const buildScript = path.join(root, 'tools', 'tui', 'build.js');
const distRel = path.join('.testCache', 'tui-build-verify', 'dist');
const distDir = path.join(root, distRel);
const manifestPath = path.join(distDir, 'tui-artifacts-manifest.json');
const checksumPath = `${manifestPath}.sha256`;

await fsPromises.rm(distDir, { recursive: true, force: true });
await fsPromises.mkdir(distDir, { recursive: true });

const runBuild = (args) => spawnSync(process.execPath, [buildScript, ...args], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    PAIROFCLEATS_TUI_DIST_DIR: distRel
  }
});

const smoke = runBuild(['--smoke']);
if (smoke.status !== 0) {
  console.error('tui verify manifest test failed: smoke build exited non-zero');
  if (smoke.stderr) console.error(smoke.stderr.trim());
  process.exit(smoke.status ?? 1);
}

if (!fs.existsSync(manifestPath) || !fs.existsSync(checksumPath)) {
  console.error('tui verify manifest test failed: expected manifest outputs missing');
  process.exit(1);
}

const verifyOk = runBuild(['--verify-manifest']);
if (verifyOk.status !== 0) {
  console.error('tui verify manifest test failed: verify mode should pass on valid manifest');
  if (verifyOk.stderr) console.error(verifyOk.stderr.trim());
  process.exit(verifyOk.status ?? 1);
}

await fsPromises.writeFile(checksumPath, `0000000000000000000000000000000000000000000000000000000000000000  tui-artifacts-manifest.json\n`, 'utf8');
const verifyBadChecksum = runBuild(['--verify-manifest']);
if (verifyBadChecksum.status === 0) {
  console.error('tui verify manifest test failed: verify mode should fail on invalid checksum');
  process.exit(1);
}

console.log('tui verify manifest test passed');
