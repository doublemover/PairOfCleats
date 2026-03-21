#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'cli');
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
const versionOutput = getCombinedOutput(versionResult, { trim: true });
if (!versionOutput.includes(version)) {
  console.error('cli --version did not output expected version');
  process.exit(1);
}

const helpResult = spawnSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
if (helpResult.status !== 0) {
  console.error('cli --help failed');
  process.exit(helpResult.status ?? 1);
}
const helpOutput = getCombinedOutput(helpResult);
if (!helpOutput.includes('Usage: pairofcleats')) {
  console.error('cli --help missing usage banner');
  process.exit(1);
}
if (!helpOutput.includes('Common workflows:')) {
  console.error('cli --help missing common workflows section');
  process.exit(1);
}
if (!helpOutput.includes('Operator commands:')) {
  console.error('cli --help missing operator section');
  process.exit(1);
}
if (!helpOutput.includes('risk delta')) {
  console.error('cli --help missing stable registry-derived risk delta entry');
  process.exit(1);
}
if (helpOutput.includes('dispatch list')) {
  console.error('cli --help should hide internal dispatch commands by default');
  process.exit(1);
}

const helpAllResult = spawnSync(process.execPath, [binPath, 'help', '--all'], { encoding: 'utf8' });
if (helpAllResult.status !== 0) {
  console.error('cli help --all failed');
  process.exit(helpAllResult.status ?? 1);
}
const helpAllOutput = getCombinedOutput(helpAllResult);
if (!helpAllOutput.includes('dispatch list')) {
  console.error('cli help --all missing internal dispatch list entry');
  process.exit(1);
}
if (!helpAllOutput.includes('bench matrix')) {
  console.error('cli help --all missing experimental bench matrix entry');
  process.exit(1);
}

const reportHelpResult = spawnSync(process.execPath, [binPath, 'help', 'report'], { encoding: 'utf8' });
if (reportHelpResult.status !== 0) {
  console.error('cli help report failed');
  process.exit(reportHelpResult.status ?? 1);
}
const reportHelpOutput = getCombinedOutput(reportHelpResult);
if (!reportHelpOutput.includes('Help topic: report')) {
  console.error('cli help report missing topic header');
  process.exit(1);
}
if (!reportHelpOutput.includes('throughput')) {
  console.error('cli help report missing report throughput subcommand');
  process.exit(1);
}

const configResult = spawnSync(
  process.execPath,
  [path.join(root, 'tools', 'config/validate.js'), '--config', configPath, '--json'],
  { encoding: 'utf8' }
);
if (configResult.status !== 0) {
  console.error('validate-config failed');
  process.exit(configResult.status ?? 1);
}

console.log('cli test passed');

