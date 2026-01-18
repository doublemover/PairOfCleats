#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const cacheRoot = path.join(root, 'tests', '.cache', 'cli');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const configPath = path.join(cacheRoot, 'config.json');
await fsPromises.writeFile(configPath, JSON.stringify({ quality: 'auto' }, null, 2));

const binPath = path.join(root, 'bin', 'pairofcleats.js');
if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI entrypoint: ${binPath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';

const versionResult = spawnSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
if (versionResult.status !== 0) {
  console.error('cli --version failed');
  process.exit(versionResult.status ?? 1);
}
if (!String(versionResult.stdout || '').trim().includes(version)) {
  console.error('cli --version did not output expected version');
  process.exit(1);
}

const helpResult = spawnSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
if (helpResult.status !== 0) {
  console.error('cli --help failed');
  process.exit(helpResult.status ?? 1);
}
if (!String(helpResult.stdout || '').includes('Usage: pairofcleats')) {
  console.error('cli --help missing usage banner');
  process.exit(1);
}

const configResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'validate-config.js'), '--config', configPath, '--json'],
  { encoding: 'utf8' }
);
if (configResult.status !== 0) {
  console.error('validate-config failed');
  process.exit(configResult.status ?? 1);
}

console.log('cli test passed');
