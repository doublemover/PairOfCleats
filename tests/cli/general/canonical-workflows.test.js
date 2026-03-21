#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-cli-canonical-'));
const env = applyTestEnv({ syncProcess: false });

const runCli = (args, options = {}) => spawnSync(
  process.execPath,
  [binPath, ...args],
  {
    encoding: 'utf8',
    env,
    cwd: options.cwd || root
  }
);

const expectHelpRoute = (args) => {
  const result = runCli([...args, '--help']);
  assert.equal(result.status, 0, `expected ${args.join(' ')} --help to succeed: ${result.stderr || result.stdout}`);
};

expectHelpRoute(['service', 'mcp']);
expectHelpRoute(['report', 'throughput']);
expectHelpRoute(['report', 'summary']);
expectHelpRoute(['report', 'parity']);
expectHelpRoute(['bench', 'language']);
expectHelpRoute(['bench', 'matrix']);
expectHelpRoute(['bench', 'summarize']);
expectHelpRoute(['bench', 'micro']);
expectHelpRoute(['sqlite', 'compact']);
expectHelpRoute(['tooling', 'uninstall']);

const configDump = runCli(['config', 'dump', '--json']);
assert.equal(configDump.status, 0, `expected config dump to succeed: ${configDump.stderr || configDump.stdout}`);
const configDumpPayload = JSON.parse(configDump.stdout || '{}');
assert.ok(configDumpPayload.repoRoot, 'expected config dump to report repoRoot');

const configFile = path.join(tempRoot, 'repo', '.pairofcleats.json');
await fsPromises.mkdir(path.dirname(configFile), { recursive: true });
await fsPromises.writeFile(configFile, JSON.stringify({ quality: 'auto' }, null, 2));

const configValidate = runCli(['config', 'validate', '--repo', path.dirname(configFile), '--config', configFile, '--json']);
assert.equal(configValidate.status, 0, `expected config validate to succeed: ${configValidate.stderr || configValidate.stdout}`);
const configValidatePayload = JSON.parse(configValidate.stdout || '{}');
assert.equal(configValidatePayload.ok, true, 'expected config validate to report ok=true');

const resetConfigPath = path.join(tempRoot, 'reset', '.pairofcleats.json');
await fsPromises.mkdir(path.dirname(resetConfigPath), { recursive: true });
await fsPromises.writeFile(resetConfigPath, JSON.stringify({ quality: 'high' }, null, 2));
const configReset = runCli(['config', 'reset', '--repo', path.dirname(resetConfigPath), '--config', resetConfigPath, '--force', '--json']);
assert.equal(configReset.status, 0, `expected config reset to succeed: ${configReset.stderr || configReset.stdout}`);
const configResetPayload = JSON.parse(configReset.stdout || '{}');
assert.equal(configResetPayload.ok, true, 'expected config reset to report ok=true');
assert.equal(fs.existsSync(resetConfigPath), true, 'expected config reset to rewrite the config file');

const toolingDetect = runCli(['tooling', 'detect', '--repo', fixtureRoot, '--json']);
assert.equal(toolingDetect.status, 0, `expected tooling detect to succeed: ${toolingDetect.stderr || toolingDetect.stdout}`);
const toolingDetectPayload = JSON.parse(toolingDetect.stdout || '{}');
assert.ok(toolingDetectPayload.languages?.python, 'expected tooling detect to report python');

const toolingInstall = runCli(['tooling', 'install', '--repo', fixtureRoot, '--tools', 'clangd', '--dry-run', '--json']);
assert.equal(toolingInstall.status, 0, `expected tooling install dry-run to succeed: ${toolingInstall.stderr || toolingInstall.stdout}`);
const toolingInstallPayload = JSON.parse(toolingInstall.stdout || '{}');
assert.ok(Array.isArray(toolingInstallPayload.results), 'expected tooling install to return results array');

console.log('canonical workflows CLI test passed');
