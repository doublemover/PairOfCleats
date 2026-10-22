import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness } from '../../helpers/vscode/runtime-harness.js';

const root = process.cwd();
const runtimePath = path.join(root, 'extensions/vscode/runtime.js');
const source = fs.readFileSync(runtimePath, 'utf8');
const runtimeRequire = createRequire(runtimePath);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-external-node-'));
const entry = path.join(temp, 'cli.js');
fs.writeFileSync(entry, 'throw new Error("version probing must not execute a workspace script");');
try {
  for (const version of ['18.17.1', '22.0.0', '24.0.0']) {
    const embedded = path.join(temp, `embedded-node-${version}.exe`);
    const module = { exports: {} };
    vm.runInNewContext(source, { module, exports: module.exports,
      require: runtimeRequire, Buffer, URL, setTimeout, clearTimeout,
      process: { ...process, execPath: embedded, versions: { ...process.versions, node: version } } },
    { filename: runtimePath });
    const result = module.exports.resolveConfiguredCli(temp, entry, ['--trace'], {
      command: 'pairofcleats', jsExtension: '.js', nodePath: process.execPath
    });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.command, fs.realpathSync(process.execPath), `embedded Node ${version} must select the canonical external executable`);
    assert.deepEqual(Array.from(result.argsPrefix), [entry, '--trace']);
  }
  const { resolveExternalNodeRuntime, resolveConfiguredCli } = runtimeRequire('./runtime.js');
  const probe = version => ({ status: 0, stdout: JSON.stringify({ version, execPath: process.execPath }), stderr: '' });
  for (const version of ['18.17.1', '22.0.0', '24.0.0', '26.8.1', '26.9.9', '26.10.0', '26.11.9', '26.12.0', '26.12.1-rc.1', '27.0.0']) {
    const result = resolveExternalNodeRuntime({ configuredPath: process.execPath, probe: () => probe(version) });
    assert.equal(result.ok, false, version);
    assert.match(result.message, />=26\.12\.1 <27/);
  }
  for (const result of [{ status: 1 }, { status: 0, stdout: '{}' }, { status: 0, stdout: 'not JSON' },
    { error: { code: 'ENOENT' } }, { error: { code: 'ETIMEDOUT' } },
    { ...probe('26.12.1'), stderr: 'unexpected runtime warning' },
    { status: 0, stdout: JSON.stringify({ version: '26.12.1', execPath: './workspace-node' }) }]) {
    assert.equal(resolveExternalNodeRuntime({ configuredPath: process.execPath, probe: () => result }).ok, false);
  }
  for (const version of ['26.12.1', '26.12.2', '26.13.0']) {
    assert.equal(resolveExternalNodeRuntime({ configuredPath: process.execPath, probe: () => probe(version) }).ok, true, version);
  }
  let calls = 0;
  const forbiddenProbe = () => { calls += 1; throw new Error('unexpected probe'); };
  assert.equal(resolveExternalNodeRuntime({ configuredPath: './workspace-node', probe: forbiddenProbe }).ok, false);
  assert.equal(resolveExternalNodeRuntime({ env: { PATH: '' }, probe: forbiddenProbe }).ok, false);
  assert.equal(calls, 0);
  const actual = resolveExternalNodeRuntime({ configuredPath: process.execPath });
  assert.equal(actual.ok, true, actual.message);
  assert.equal(actual.command, fs.realpathSync(process.execPath));
  assert.equal(actual.version, process.versions.node);
  const binary = resolveConfiguredCli(temp, 'pairofcleats', [], { resolveNode: forbiddenProbe });
  assert.equal(binary.ok, true, 'an executable CLI does not require an unrelated external runtime');
  assert.equal(calls, 0);

  fs.mkdirSync(path.join(temp, 'tools/config'), { recursive: true });
  fs.writeFileSync(path.join(temp, 'tools/config/dump.js'), 'throw new Error("explicit operator fixture only");');
  const workspaceNode = path.join(temp, 'untrusted-workspace-node.exe');
  const harness = createVsCodeRuntimeHarness({ repoRoot: temp,
    configValues: { nodePath: workspaceNode, env: { PATH: temp } },
    globalConfigValues: { cliPath: entry, nodePath: process.execPath } });
  harness.activate();
  try {
    const result = harness.extension._test.resolveCli(temp, harness.fakeVscode.workspace.getConfiguration());
    assert.equal(result.ok, true);
    assert.equal(result.command, actual.command);
    harness.queuedResults.push({ code: 0, stdout: '{}' });
    const spec = harness.extension._test.OPERATOR_COMMAND_SPECS.find(value => value.id === 'pairofcleats.configDump');
    await harness.extension._test.runOperatorCommand(spec);
    assert.equal(harness.spawnCalls.length, 1);
    assert.equal(harness.spawnCalls[0].command, actual.command);
    assert.deepEqual(harness.spawnCalls[0].args, [entry, 'config', 'dump', '--json', '--repo', temp],
      'operators dispatch through the configured installation, never a target-owned script');
    for (const call of harness.nodeProbeCalls) {
      assert.equal(call.command, process.execPath, 'only the global executable setting approves a runtime');
      assert.equal(call.options.timeout, 3000);
      assert.equal(call.options.shell, false);
      assert.equal(call.options.windowsHide, true);
      assert.notEqual(call.options.env.PATH, temp, 'workspace environment cannot choose the probe executable');
      assert.ok(call.args[1].includes('process.versions.node'));
    }
    const before = harness.nodeProbeCalls.length;
    harness.fakeVscode.workspace.isTrusted = false;
    assert.equal(harness.extension._test.resolveCli(temp, harness.fakeVscode.workspace.getConfiguration()).ok, false);
    await harness.extension._test.runOperatorCommand(spec);
    assert.equal(harness.nodeProbeCalls.length, before, 'untrusted workspaces cannot launch even a runtime probe');
    assert.equal(harness.spawnCalls.length, 1);
  } finally { harness.restoreGlobals(); }

  const incompatible = createVsCodeRuntimeHarness({ repoRoot: temp,
    globalConfigValues: { cliPath: entry, nodePath: process.execPath }, nodeProbeResult: probe('24.0.0') });
  incompatible.activate();
  try {
    assert.equal(incompatible.extension._test.resolveCli(temp, incompatible.fakeVscode.workspace.getConfiguration()).ok, false);
    const spec = incompatible.extension._test.OPERATOR_COMMAND_SPECS.find(value => value.id === 'pairofcleats.configDump');
    await incompatible.extension._test.runOperatorCommand(spec);
    assert.equal(incompatible.spawnCalls.length, 0, 'incompatible runtime blocks JS and script commands without host fallback');
    assert.ok(incompatible.errorMessages.some(message => message.includes('>=26.12.1 <27')));
  } finally { incompatible.restoreGlobals(); }

  const contract = runtimeRequire('./editor-config-contract.json');
  const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(rootManifest.engines.node, `>=${contract.cli.minimumNodeVersion} <${Number(contract.cli.minimumNodeVersion.split('.')[0]) + 1}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extensions/vscode/package.json'), 'utf8'));
  const setting = manifest.contributes.configuration.properties['pairofcleats.nodePath'];
  assert.equal(setting.scope, 'machine');
  assert.equal(setting.default, '');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('Checkout JS entrypoints select validated external Node independently from embedded editor runtimes.');
