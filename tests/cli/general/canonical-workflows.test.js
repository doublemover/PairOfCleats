#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const cases = ['config', 'tooling-detect', 'tooling-preview'];
assert.deepEqual(JSON.parse(await fsPromises.readFile(new URL('./canonical-workflows.test.js.cases.json', import.meta.url))),
  { schemaVersion: 1, cases });
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('cli/general/canonical-workflows/')[1];
assert.ok(cases.includes(selected), 'run an independently bounded canonical workflow');
const root = process.cwd();
const binPath = path.join(root, 'bin', 'pairofcleats.js');
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'languages');
const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-cli-canonical-'));
const env = applyTestEnv({ syncProcess: false });

const runCli = (args, options = {}) => runNode(
  [binPath, ...args],
  `pairofcleats ${args.join(' ')}`,
  options.cwd || root,
  env,
  { stdio: 'pipe', allowFailure: options.allowFailure === true }
);

if (selected === 'config') {
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

}
if (selected === 'tooling-detect') {
  const toolingDetect = runCli(['tooling', 'detect', '--root', fixtureRoot, '--json']);
  assert.equal(toolingDetect.status, 0, `expected tooling detect to succeed: ${toolingDetect.stderr || toolingDetect.stdout}`);
  const toolingDetectPayload = JSON.parse(toolingDetect.stdout || '{}');
  assert.ok(toolingDetectPayload.languages?.python, 'expected tooling detect to report python');

}
if (selected === 'tooling-preview') {
  const toolingInstall = runCli(['tooling', 'install', '--root', fixtureRoot, '--tools', 'clangd', '--dry-run', '--json'],
    { allowFailure: true });
  const toolingInstallPayload = JSON.parse(toolingInstall.stdout || '{}');
  assert.ok(Array.isArray(toolingInstallPayload.results), 'expected tooling install to return results array');
  assert.deepEqual(toolingInstallPayload.results, [], 'a preview must not execute an installation');
  assert.equal(toolingInstallPayload.preview.execution, 'none');
  assert.equal(toolingInstallPayload.preview.writes, 'none');
  assert.equal(toolingInstallPayload.readiness.verification, 'not-probed');
  assert.equal(toolingInstallPayload.readiness.ready, false);
  assert.equal(toolingInstallPayload.preview.entries.length, 1);
  assert.equal(toolingInstallPayload.preview.entries[0].id, 'clangd');
  const blocked = toolingInstallPayload.preview.entries.some(entry => entry.blockers.length > 0);
  assert.equal(toolingInstallPayload.preview.state, blocked ? 'blocked-or-unqualified' : 'planned-not-probed');
  assert.equal(toolingInstall.status, blocked ? 1 : 0, 'the actual preview blockers determine exit status');

}
const owned = path.resolve(tempRoot);
assert.equal(path.relative(path.resolve(os.tmpdir()), path.dirname(owned)), '');
assert.ok(path.basename(owned).startsWith('poc-cli-canonical-'));
await fsPromises.rm(owned, { recursive: true, force: true });
console.log(`canonical workflow ${selected} passed`);
