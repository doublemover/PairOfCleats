#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const cacheRoot = resolveTestCachePath(root, 'cli');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const env = applyTestEnv({ cacheRoot, syncProcess: false });

const binPath = path.join(root, 'bin', 'pairofcleats.js');
if (!fs.existsSync(binPath)) {
  console.error(`Missing CLI entrypoint: ${binPath}`);
  process.exit(1);
}

const runCli = (...args) => spawnSync(process.execPath, [binPath, ...args], {
  encoding: 'utf8',
  cwd: root,
  env
});

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version || '0.0.0';

const versionResult = runCli('--version');
if (versionResult.status !== 0) {
  console.error('cli --version failed');
  process.exit(versionResult.status ?? 1);
}
const versionOutput = getCombinedOutput(versionResult, { trim: true });
if (!versionOutput.includes(version)) {
  console.error('cli --version did not output expected version');
  process.exit(1);
}

const helpResult = runCli('--help');
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
if (!helpOutput.includes('CLI:')) {
  console.error('cli --help missing CLI section');
  process.exit(1);
}
if (!helpOutput.includes('cli completions')) {
  console.error('cli --help missing cli completions entry');
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

const helpAliasAllResult = runCli('--help', '--all');
if (helpAliasAllResult.status !== 0) {
  console.error('cli --help --all failed');
  process.exit(helpAliasAllResult.status ?? 1);
}
const helpAliasAllOutput = getCombinedOutput(helpAliasAllResult);
if (!helpAliasAllOutput.includes('dispatch list')) {
  console.error('cli --help --all missing internal dispatch list entry');
  process.exit(1);
}
if (!helpAliasAllOutput.includes('bench matrix')) {
  console.error('cli --help --all missing experimental bench matrix entry');
  process.exit(1);
}

const reportHelpResult = runCli('help', 'report');
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

const malformedHelpResult = runCli('help', 'report', 'typo');
if (malformedHelpResult.status === 0) {
  console.error('cli help report typo should fail');
  process.exit(1);
}
const malformedHelpOutput = getCombinedOutput(malformedHelpResult);
if (!malformedHelpOutput.includes('Unknown help topic: report typo')) {
  console.error('cli help report typo missing unknown-topic error');
  process.exit(1);
}

const mcpAliasHelpResult = runCli('service', 'mcp', '--mcpMode', 'sdk', '--help');
if (mcpAliasHelpResult.status !== 0) {
  console.error('cli service mcp --mcpMode --help failed');
  process.exit(mcpAliasHelpResult.status ?? 1);
}
const mcpAliasOutput = getCombinedOutput(mcpAliasHelpResult);
if (mcpAliasOutput.includes('Unknown flag: --mcpMode')) {
  console.error('cli service mcp rejected --mcpMode alias');
  process.exit(1);
}

console.log('cli test passed');

