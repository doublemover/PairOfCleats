#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCli } from '../../src/shared/cli.js';

const argv = createCli({
  scriptName: 'tui-install',
  options: {
    json: { type: 'boolean', default: false },
    target: { type: 'string', default: '' },
    'install-root': { type: 'string', default: '' }
  }
}).parse();

const root = process.cwd();
const targetsPath = path.join(root, 'tools', 'tui', 'targets.json');
const distDir = path.join(root, 'dist', 'tui');

const inferTarget = () => {
  if (argv.target) return argv.target;
  if (process.platform === 'win32') return 'x86_64-pc-windows-msvc';
  if (process.platform === 'darwin') {
    return os.arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  return 'x86_64-unknown-linux-gnu';
};

const main = async () => {
  const payload = JSON.parse(await fsPromises.readFile(targetsPath, 'utf8'));
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  const triple = inferTarget();
  const target = targets.find((entry) => entry?.triple === triple);
  if (!target) {
    throw new Error(`unsupported target triple: ${triple}`);
  }
  const artifactPath = path.join(distDir, String(target.artifactName));
  const installRoot = argv['install-root']
    ? path.resolve(argv['install-root'])
    : path.join(root, '.cache', 'tui', triple);
  const outputPath = path.join(installRoot, path.basename(artifactPath));

  await fsPromises.mkdir(installRoot, { recursive: true });
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`missing TUI artifact: ${path.relative(root, artifactPath)}`);
  }
  await fsPromises.copyFile(artifactPath, outputPath);

  const result = {
    ok: true,
    triple,
    artifact: path.relative(root, artifactPath).replace(/\\/g, '/'),
    installedTo: path.relative(root, outputPath).replace(/\\/g, '/')
  };

  if (argv.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stderr.write(`[tui-install] installed ${result.artifact} -> ${result.installedTo}\n`);
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
