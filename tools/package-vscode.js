#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertPinnedPackagingToolchain,
  buildDeterministicZip,
  writeArchiveChecksums
} from './tooling/archive-determinism.js';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const readOption = (name, fallback = '') => {
  const flag = `--${name}`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === flag) {
      const next = args[i + 1];
      return typeof next === 'string' ? next : fallback;
    }
    if (typeof arg === 'string' && arg.startsWith(`${flag}=`)) {
      return arg.slice(flag.length + 1);
    }
  }
  return fallback;
};

if (hasFlag('--help') || hasFlag('-h')) {
  console.error('Usage: node tools/package-vscode.js [--out-dir <dir>] [--smoke]');
  process.exit(0);
}

const root = process.cwd();
const sourceDir = path.join(root, 'extensions', 'vscode');
const outDir = path.resolve(root, readOption('out-dir', path.join('dist', 'vscode')));
const archivePath = path.join(outDir, 'pairofcleats.vsix');
const checksumPath = `${archivePath}.sha256`;
const manifestPath = `${archivePath}.manifest.json`;
const smoke = hasFlag('--smoke');

if (!fs.existsSync(sourceDir)) {
  console.error(`VS Code package source not found: ${sourceDir}`);
  process.exit(1);
}
if (!fs.existsSync(path.join(sourceDir, 'package.json'))) {
  console.error('VS Code package source missing package.json.');
  process.exit(1);
}
if (!fs.existsSync(path.join(sourceDir, 'extension.js'))) {
  console.error('VS Code package source missing extension.js.');
  process.exit(1);
}

try {
  assertPinnedPackagingToolchain({ requireNpm: true });
  const npmProbe = spawnSync('npm', ['--version'], { encoding: 'utf8' });
  if (npmProbe.status !== 0) {
    throw new Error('Packaging toolchain error: npm is required for VS Code packaging.');
  }
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}

const built = await buildDeterministicZip({
  sourceDir,
  archivePath,
  rootPrefix: 'extension'
});

const manifest = await writeArchiveChecksums({
  archivePath,
  checksum: built.checksum,
  entries: built.entries,
  checksumPath,
  manifestPath,
  toolchain: {
    node: process.versions.node,
    npmRequired: true,
    archive: 'vsix(zip)'
  }
});

if (smoke) {
  if (!fs.existsSync(archivePath)) {
    console.error('VS Code smoke packaging failed: archive not created.');
    process.exit(1);
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    console.error('VS Code smoke packaging failed: manifest entries missing.');
    process.exit(1);
  }
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  archive: path.relative(root, archivePath).replace(/\\/g, '/'),
  checksum: built.checksum,
  entries: built.entries.length
})}\n`);
