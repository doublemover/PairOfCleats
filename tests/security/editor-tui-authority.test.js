import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../helpers/vscode/runtime-harness.js';
import { resolveTuiSupervisorPath } from '../../bin/tui-supervisor-path.js';
import { resolveTuiWrapperEnv } from '../../bin/tui-wrapper-env.js';

const require = createRequire(import.meta.url);
const { buildDestinationBoundApiHeaders } = require('../../extensions/vscode/security.js');
const { normalizeApiBaseUrl } = require('../../extensions/vscode/runtime.js');
const settings = { endpointKey: 'apiServerUrl', envKey: 'env', processEnv: { PAIROFCLEATS_API_TOKEN: 'inert-token-fixture' } };
const config = (userEndpoint, userEnv, workspaceEndpoint) => ({
  get: () => workspaceEndpoint,
  inspect: (key) => ({ globalValue: key === 'apiServerUrl' ? userEndpoint : userEnv })
});
assert.deepEqual(buildDestinationBoundApiHeaders(config(null, null, 'https://example.invalid'), 'https://example.invalid', settings), {});
assert.deepEqual(buildDestinationBoundApiHeaders(config('https://EXAMPLE.invalid:443/api', null), 'https://example.invalid', settings), { Authorization: 'Bearer inert-token-fixture' });
for (const destination of ['http://example.invalid', 'https://elsewhere.invalid', 'https://example.invalid:444']) {
  assert.deepEqual(buildDestinationBoundApiHeaders(config('https://example.invalid', null), destination, settings), {});
}
assert.equal(normalizeApiBaseUrl('https://unused:unused@example.invalid'), '');

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-editor-trust-' });
const manifest = JSON.parse(fs.readFileSync('extensions/vscode/package.json'));
const defaults = Object.fromEntries(Object.entries(manifest.contributes.configuration.properties)
  .filter(([key]) => key.includes('.inline')).map(([key, value]) => [key.split('.').at(-1), value.default]));
const harness = createVsCodeRuntimeHarness({ repoRoot: workspace.root, activeFile: path.join(workspace.root, 'src', 'app.ts'), isTrusted: false, configValues: defaults });
try {
  harness.activate();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(harness.spawnCalls.length, 0, 'untrusted startup with real inline defaults must not spawn');
  const api = harness.extension._test;
  const repoContext = { repoRoot: workspace.root, folderName: 'fixture' };
  await api.runSavedSearchInvocation({ invocation: { command: 'unused', args: [] } }, repoContext);
  await api.runSavedSearchInvocation({ invocation: { kind: 'api-search', baseUrl: 'https://example.invalid', payload: {} } }, repoContext);
  for (const command of ['pairofcleats.configDump', 'pairofcleats.indexHealth', 'pairofcleats.indexValidate', 'pairofcleats.indexBuild']) {
    await harness.runCommand(command);
  }
  assert.equal(harness.spawnCalls.length, 0, 'saved, operator and managed commands must fail closed');
  assert.equal(harness.fetchCalls.length, 0, 'untrusted workspaces must not issue background/API requests');
  const cli = api.resolveCli(workspace.root, harness.fakeVscode.workspace.getConfiguration());
  assert.equal(cli.command, 'pairofcleats', 'repository implementation is never selected implicitly');
} finally { harness.restoreGlobals(); }

const pending = createVsCodeRuntimeHarness({ repoRoot: workspace.root });
try {
  pending.activate();
  pending.fakeVscode.window.showInputBox = async () => {
    pending.fakeVscode.workspace.isTrusted = false;
    return 'fixture';
  };
  await pending.runCommand('pairofcleats.search');
  assert.equal(pending.spawnCalls.length, 0, 'trust revoked during an async input must be rechecked at spawn');
} finally { pending.restoreGlobals(); }

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poc-tui-path-')));
try {
  const supervisor = path.join(tmp, 'tools', 'tui', 'supervisor.js');
  fs.mkdirSync(path.dirname(supervisor), { recursive: true });
  fs.writeFileSync(supervisor, 'inert supervisor fixture, never executed');
  const metadata = { supervisor: { path: 'tools/tui/supervisor.js', sha256: crypto.createHash('sha256').update(fs.readFileSync(supervisor)).digest('hex') } };
  assert.equal(resolveTuiSupervisorPath(tmp, metadata), supervisor);
  assert.throws(() => resolveTuiSupervisorPath(tmp, {}), /digest/);
  assert.throws(() => resolveTuiSupervisorPath(tmp, { supervisor: { ...metadata.supervisor, path: '../other.js' } }), /digest/);
  fs.appendFileSync(supervisor, ' changed');
  assert.throws(() => resolveTuiSupervisorPath(tmp, metadata), /checksum/);
  const alternate = path.join(tmp, 'alternate.fixture');
  fs.writeFileSync(alternate, 'inert companion fixture');
  fs.unlinkSync(supervisor);
  fs.symlinkSync(alternate, supervisor);
  assert.throws(() => resolveTuiSupervisorPath(tmp, metadata), /symlink/);
  const env = await resolveTuiWrapperEnv({ runtimeRoot: tmp, supervisorPath: supervisor, baseEnv: { PAIROFCLEATS_TUI_NODE: 'unused-relative-node', PAIROFCLEATS_TUI_SUPERVISOR: 'unused-relative-script' } });
  assert.equal(env.PAIROFCLEATS_TUI_NODE, process.execPath);
  assert.equal(env.PAIROFCLEATS_TUI_SUPERVISOR, supervisor);
  assert.equal(env.PAIROFCLEATS_TUI_WORKSPACE_ROOT, process.cwd());
  const rust = fs.readFileSync('crates/pairofcleats-tui/src/main.rs', 'utf8');
  assert.doesNotMatch(rust, /\.arg\("tools\/tui\/supervisor\.js"\)/);
  assert.doesNotMatch(rust, /Command::new\("node"\)/);
  console.log('editor startup/async trust, destination-bound tokens and TUI pinned companion checks passed');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
