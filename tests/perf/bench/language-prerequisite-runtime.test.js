#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBenchmarkPrerequisites } from '../../../tools/bench/language/prerequisite-runtime.js';
import { resolveToolsById } from '../../../tools/tooling/utils.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prerequisite-runtime-'));
try {
  for (const [name, text] of [['main.go', 'package main\n'], ['settings.yaml', 'key: value\n'],
    ['view.jsx', 'export const view = <main/>;\n'], ['lib.lua', 'return 1\n'], ['lib.rs', 'fn main() {}\n']]) {
    fs.writeFileSync(path.join(root, name), text);
  }
  const toolingConfig = { dir: path.join(root, 'managed'), autoEnableOnDetect: true, lsp: { enabled: true } };
  const commands = [];
  const dependencies = {
    loadUserConfig: () => ({ indexing: { embeddings: { enabled: false } } }),
    getDictConfig: () => ({ languages: [], files: [], dir: path.join(root, 'dictionaries') }),
    getToolingConfig: () => toolingConfig,
    getVectorConfig: () => ({ enabled: false }),
    loadTypescript: () => ({ version: '5.9.3' }),
    async runCommand(command) {
      commands.push(command);
      const ids = command.args[command.args.indexOf('--tools') + 1].split(',');
      return { ok: true, exitCode: 0, payload: { readiness: { items: ids.map((id) => ({ id,
        state: 'installed-and-verified', verificationLevel: 'executable-probe-and-layout' })) } } };
    },
    async runDoctor(ctx, ids, options) {
      assert.equal(ctx.repoRoot, root);
      assert.equal(ctx.toolingConfig, toolingConfig);
      assert.notEqual(options.handshakeCwd, root, 'untrusted checkout is not the initialization context');
      assert.equal(fs.readdirSync(options.handshakeCwd).length, 0, 'protocol context contains no project files');
      return { identity: { chunkUid: { available: true } }, providers: ids.map((id) => ({
        id, enabled: true, available: id !== 'rust-analyzer', status: id === 'rust-analyzer' ? 'warn' : 'ok',
        handshake: id === 'typescript' || id === 'rust-analyzer' ? null : { ok: true, latencyMs: 1 },
        checks: id === 'rust-analyzer' ? [{ name: 'rust_workspace_trust_required', status: 'warn', message: 'exact grant required' }] : []
      })) };
    },
    verifyModel() { throw new Error('disabled embeddings must not load or download a model'); }
  };
  const common = { repoRoot: root, scriptRoot: process.cwd(), buildRoot: path.join(root, 'receipts'), dependencies };
  const checked = await checkBenchmarkPrerequisites(common);
  assert.ok(checked.languages.includes('javascript'), 'JSX-only source is discovered');
  assert.ok(checked.languages.includes('go') && checked.languages.includes('yaml') && checked.languages.includes('lua'));
  assert.ok(checked.tools.includes('gopls') && checked.tools.includes('lua-language-server') && checked.tools.includes('yaml-language-server'));
  assert.equal(checked.readiness.state, 'degraded', 'an installed but denied workspace is not declared ready');
  assert.ok(checked.readiness.items.find((item) => item.id === 'provider:rust-analyzer').reason.includes('rust_workspace_trust_required'));
  assert.equal(commands.length, 1);
  assert.equal(commands[0].scriptRoot, process.cwd());
  assert.ok(commands[0].args[0].endsWith('tools/tooling/install.js'));
  assert.equal(checked.installationReceipt.payload.readiness.items.length, checked.tools.length);
  const missingCompiler = await checkBenchmarkPrerequisites({ ...common, dependencies: { ...dependencies, loadTypescript: () => null } });
  assert.ok(missingCompiler.tools.includes('tsserver'), 'a missing compiler API selects its managed package recipe');
  commands.length = 0;
  const noInstall = await checkBenchmarkPrerequisites({ ...common, autoInstall: false });
  assert.equal(commands.length, 0, 'explicit check-only mode never invokes an installer');
  assert.equal(noInstall.readiness.state, 'degraded');
  const aliases = resolveToolsById(['gopls', 'sourcekit-lsp', 'tsserver'], toolingConfig.dir, root, {
    enabledTools: ['lsp-gopls', 'sourcekit', 'typescript'], disabledTools: ['lsp-gopls'] });
  assert.deepEqual(aliases.map((tool) => tool.id).sort(), ['sourcekit-lsp', 'tsserver'], 'runtime provider IDs select installation recipes and exclusions still win');
  let modelProbes = 0;
  const model = await checkBenchmarkPrerequisites({ ...common, dependencies: { ...dependencies,
    loadUserConfig: () => ({ indexing: { embeddings: { enabled: true } } }),
    getModelConfig: () => ({ id: 'fixture-model', dir: path.join(root, 'models') }),
    async verifyModel() {
      modelProbes += 1;
      if (modelProbes === 1) throw new Error('incomplete local cache');
      return { dimensions: 384, provider: 'fixture', verificationLevel: 'local-model-inference' };
    },
    async runCommand(command) {
      if (command.args[0].endsWith('tools/download/models.js')) return { ok: true, exitCode: 0 };
      return dependencies.runCommand(command);
    }
  } });
  assert.equal(modelProbes, 2, 'installation is followed by the same actual model verification');
  assert.equal(model.readiness.items.find((item) => item.id === 'embedding-model').details.dimensions, 384);
  const malformed = await checkBenchmarkPrerequisites({ ...common, dependencies: { ...dependencies,
    async runCommand() { return { ok: true, payload: { readiness: { items: [] } } }; }
  } });
  assert.ok(malformed.readiness.items.some((item) => item.id.startsWith('install:') && item.state === 'failed'), 'exit zero and an empty receipt do not prove installation');

  // Exercise the real resolver, doctor, JSON-RPC initialize and teardown with an app-owned inert server.
  fs.writeFileSync(path.join(root, 'tiny.py'), 'def value():\n    return 1\n');
  const fixturePath = path.join(process.cwd(), 'tests/fixtures/lsp/stub-lsp-server.js');
  const actualConfig = { dir: toolingConfig.dir, autoEnableOnDetect: false, enabledTools: ['lsp-bench-fixture'],
    lsp: { enabled: true, autoPresets: false, servers: [{ id: 'bench-fixture', cmd: process.execPath,
      args: [fixturePath, '--mode', 'pyright', '--exit-on-shutdown'], languages: ['python'] }] } };
  const actual = await checkBenchmarkPrerequisites({ ...common, autoInstall: false, dependencies: {
    loadUserConfig: dependencies.loadUserConfig, getToolingConfig: () => actualConfig,
    getDictConfig: dependencies.getDictConfig, getVectorConfig: dependencies.getVectorConfig
  } });
  const provider = actual.doctor.providers[0];
  assert.equal(provider.id, 'lsp-bench-fixture');
  assert.ok(provider.command.resolved.args.includes(fixturePath), 'verification must use the actual configured server arguments');
  assert.equal(provider.handshake.ok, true);
  assert.equal(provider.handshake.scope, 'installation-only');
  assert.notEqual(provider.handshake.contextRoot, root);
  assert.equal(fs.existsSync(provider.handshake.contextRoot), false, 'owned context is removed after protocol shutdown');
  assert.equal(actual.readiness.state, 'ready');
  assert.equal(actual.readiness.items[0].verificationLevel, 'installation-protocol-and-workspace-checks');
  const cliRoot = path.join(root, 'cli');
  fs.mkdirSync(cliRoot);
  fs.writeFileSync(path.join(cliRoot, '.pairofcleats.json'), JSON.stringify({ indexing: { embeddings: { enabled: true } } }));
  const dictionaryDir = path.join(root, 'cli-dictionaries');
  fs.mkdirSync(dictionaryDir);
  fs.writeFileSync(path.join(dictionaryDir, 'en.txt'), 'benchmark\nprerequisite\n');
  const outputPath = path.join(root, 'cli-receipt.json');
  const cli = await spawnSubprocess(process.execPath, [path.join(process.cwd(), 'tools/bench/language/prerequisite-check.js'),
    '--repo', cliRoot, '--out', outputPath, '--no-install', '--stub-embeddings'], {
    cwd: process.cwd(), env: { ...process.env, PAIROFCLEATS_DICT_DIR: dictionaryDir }, timeoutMs: 10000, maxOutputBytes: 32768 });
  assert.equal(cli.exitCode, 0);
  const cliReceipt = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(cliReceipt.repoRoot, cliRoot);
  assert.equal(cliReceipt.autoInstall, false);
  assert.equal(cliReceipt.readiness.state, 'ready');
  assert.ok(!cliReceipt.readiness.items.some((item) => item.id === 'embedding-model'), 'actual stub CLI does not probe/load a model');
  assert.match(cliReceipt.effectiveConfigHash, /^[a-f0-9]{40}$/u);
  assert.equal(cliReceipt.runtime.nodeVersion, process.version);
  console.log('Mixed-language provisioning, configured recipe aliases, receipt/model verification and real inert initialize pass.');
} finally {
  await cleanupLspTestRuntime({ strict: true });
  fs.rmSync(root, { recursive: true, force: true });
}
