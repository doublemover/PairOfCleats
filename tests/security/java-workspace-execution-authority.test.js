import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWorkspaceExecutionAuthority } from '../../src/shared/workspace-execution-authority.js';
import { createConfiguredLspProvider } from '../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../src/index/tooling/lsp-provider/normalize.js';
import { createJdtlsProvider } from '../../src/index/tooling/jdtls-provider.js';
import { createDedicatedLspProvider } from '../../src/index/tooling/dedicated-lsp-provider.js';
import { probeLspInitializeHandshake, resolveToolingCommandProfile } from '../../src/index/tooling/command-resolver.js';
import { runToolingDoctor } from '../../src/index/tooling/doctor.js';
import { registerDefaultToolingProviders } from '../../src/index/tooling/providers/index.js';
import { resolveRuntimeRequirementsPreflight } from '../../src/index/tooling/preflight/runtime-requirements-preflight.js';
import { collectConfiguredOutput } from '../../src/index/tooling/lsp-provider/runtime.js';
import { collectLspTypes } from '../../src/integrations/tooling/providers/lsp.js';
import { buildTreeSitterChunks } from '../../src/lang/tree-sitter/chunking.js';
import { getToolingRegistry } from '../../tools/tooling/utils.js';

const container = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-java-authority-'));
const repo = path.join(container, 'repo');
const outside = path.join(container, 'outside');
fs.mkdirSync(repo);
fs.mkdirSync(outside);
fs.mkdirSync(path.join(repo, 'nested'));
const text = 'class App { int add(int a, int b) { return a + b; } }\n';
fs.writeFileSync(path.join(repo, 'App.java'), text);
const counter = path.join(container, 'counter');
const cache = path.join(container, 'denied-cache');
const priorTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS;
const priorCounter = process.env.POC_LSP_COUNTER;
const stub = path.resolve('tests/fixtures/lsp/stub-lsp-server.js');
const server = normalizeServerConfig({ id: 'custom-java-fixture', languages: ['java'],
  cmd: process.execPath, args: [stub, '--mode', 'java', '--exit-on-shutdown'], requireWorkspaceModel: false }, 0);
const configured = createConfiguredLspProvider(server);
const dedicated = createJdtlsProvider();
const ctx = { repoRoot: repo, buildRoot: cache, cache: { enabled: true, dir: cache }, trusted: true,
  toolingConfig: { lsp: { enabled: true }, jdtls: { enabled: true, cmd: process.execPath,
    args: server.args, workspaceDataDir: cache, requireWorkspaceModel: false } } };
const inputs = { documents: [{ virtualPath: 'App.java', text, languageId: 'java', effectiveExt: '.java' }],
  targets: [{ chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:java:authority', chunkId: 'java-authority',
    file: 'App.java', range: { start: 0, end: text.length } }, virtualPath: 'App.java',
  virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'add', kind: 'function' } }],
  kinds: ['types'], toolingPreflightWaveToken: 'same-wave' };
const grant = () => { process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]); };
const assertBlocked = (output) => {
  assert.deepEqual(output.byChunkUid, {});
  assert.ok(output.diagnostics.checks.some((check) => check.name === 'java_workspace_trust_required'));
};
try {
  delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  process.env.POC_LSP_COUNTER = counter;
  fs.writeFileSync(path.join(repo, '.pairofcleats.json'), JSON.stringify({ trusted: true }));
  const configuredHash = configured.getConfigHash(ctx);
  const dedicatedHash = dedicated.getConfigHash(ctx);
  assert.equal((await configured.preflight(ctx, inputs)).reasonCode, 'java_workspace_trust_required');
  assert.equal((await dedicated.preflight(ctx, inputs)).reasonCode, 'java_workspace_trust_required');
  const profile = resolveToolingCommandProfile({ providerId: 'jdtls', cmd: process.execPath,
    args: server.args, repoRoot: repo });
  assert.equal(profile.resolved.mode, 'blocked');
  assert.deepEqual(profile.probe.attempted, []);
  assert.equal(resolveRuntimeRequirementsPreflight({ ctx, providerId: 'jdtls',
    requirements: [{ id: 'java', cmd: process.execPath, args: [stub] }] }).blockProvider, true);
  assertBlocked(await configured.run(ctx, inputs));
  assertBlocked(await dedicated.run(ctx, inputs));
  const direct = await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath,
    args: server.args, providerId: 'custom-alias', sessionPoolingEnabled: false });
  assert.equal(direct.runtime.executionAuthority.reasonCode, 'java_workspace_trust_required');
  assert.equal((await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath,
    args: server.args, collectTypes: false, captureDiagnostics: true })).runtime.executionAuthority.reasonCode,
  'java_workspace_trust_required');
  assert.ok((await collectConfiguredOutput({ server, providerId: configured.id, ctx, provider: configured,
    docs: inputs.documents, targets: inputs.targets })).checks.some((check) => check.name === 'java_workspace_trust_required'));
  assert.equal(fs.existsSync(counter), false, 'denied probes and clients never start');
  assert.equal(fs.existsSync(cache), false, 'denied bootstrap does not create workspace/cache state');
  assert.equal((await probeLspInitializeHandshake({ providerId: 'jdtls', cwd: repo,
    cmd: process.execPath, args: server.args })).errorCode, 'java_workspace_trust_required');
  registerDefaultToolingProviders();
  const report = await runToolingDoctor({ ...ctx, buildRoot: path.join(container, 'doctor-report'),
    toolingConfig: { enabledTools: ['jdtls'] } }, ['jdtls'], {
    resolveCommandProfile: () => { throw new Error('Denied doctor must not call a command/probe resolver'); }
  });
  assert.ok(report.providers[0].checks.some((check) => check.name === 'java_workspace_trust_required'));
  assert.equal(report.providers[0].handshake, undefined);
  assert.equal(report.providers[0].runtimeRequirements, undefined);

  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([container]);
  assert.ok(resolveWorkspaceExecutionAuthority({ repoRoot: repo, providerId: 'jdtls' }));
  grant();
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: path.join(repo, 'nested'), server }), null);
  assert.ok(resolveWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: outside, server }));
  fs.symlinkSync(outside, path.join(repo, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.ok(resolveWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: path.join(repo, 'escape'), server }));
  assert.notEqual(configured.getConfigHash(ctx), configuredHash);
  assert.notEqual(dedicated.getConfigHash(ctx), dedicatedHash);

  let preflightCalls = 0;
  dedicated.preflight = async () => {
    preflightCalls += 1;
    await new Promise((resolve) => setImmediate(resolve));
    delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
    return { state: 'ready' };
  };
  assertBlocked(await dedicated.run(ctx, inputs));
  assert.equal(preflightCalls, 1);
  assertBlocked(await dedicated.run(ctx, inputs));
  assert.equal(preflightCalls, 1, 'revoked trust rejects before reuse of a ready cached preflight');
  assert.equal(dedicated.getConfigHash(ctx), dedicatedHash);
  grant();
  configured.preflight = dedicated.preflight;
  assertBlocked(await configured.run(ctx, inputs));

  const pending = createDedicatedLspProvider({ id: 'jdtls', label: 'benign Java preflight', languages: ['java'],
    configKey: 'jdtls', docExtensions: ['.java'], command: { defaultCmd: process.execPath },
    parseSignature: () => null, preflight: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
      return { state: 'ready' };
    } });
  grant();
  assert.equal((await pending.preflight({ ...ctx, toolingConfig: { jdtls: {
    enabled: true, cmd: process.execPath, args: ['--version'] } } }, inputs)).reasonCode, 'java_workspace_trust_required');
  assert.equal(fs.existsSync(counter), false);
  assert.equal(fs.existsSync(cache), false);

  let preparationCleanups = 0;
  const preparing = createDedicatedLspProvider({ id: 'jdtls', label: 'benign Java preparation', languages: ['java'],
    configKey: 'jdtls', docExtensions: ['.java'], command: { defaultCmd: process.execPath },
    parseSignature: () => null, preflight: async () => ({ state: 'ready' }),
    prepareCollect: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
      return { cleanup: () => { preparationCleanups += 1; } };
    } });
  preparing.preflight = async () => ({ state: 'ready', commandProfile: {
    requested: { cmd: process.execPath, args: server.args },
    resolved: { cmd: process.execPath, args: server.args, mode: 'direct' }, probe: { ok: true, attempted: [] }
  } });
  grant();
  assertBlocked(await preparing.run(ctx, inputs));
  assert.equal(preparationCleanups, 1, 'revoked pending preparation releases its owned resources');
  assert.equal(fs.existsSync(counter), false, 'revoked preparation cannot start a client');

  const chunks = buildTreeSitterChunks({ text, languageId: 'java', ext: '.java',
    options: { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false } } });
  assert.ok(chunks.some((chunk) => chunk.name === 'App.add'), 'native Java AST does not require execution trust');
  assert.equal(getToolingRegistry(path.join(container, 'tool-cache'), repo).find((tool) => tool.id === 'jdtls').install.manual, true);
  grant();
  const allowed = await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath,
    args: server.args, providerId: 'jdtls', sessionPoolingEnabled: false, vfsColdStartCache: false,
    timeoutMs: 3000, retries: 0, strict: false });
  assert.ok(!allowed.checks.some((check) => check.name === 'java_workspace_trust_required'));
  assert.ok(fs.readFileSync(counter, 'utf8').includes('spawn'));
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: repo, providerId: 'yaml-language-server' }), null);
  console.log('Exact Java grants guard dedicated/configured probes, caches and pending launches; native AST remains available');
} finally {
  if (priorTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrust;
  if (priorCounter === undefined) delete process.env.POC_LSP_COUNTER;
  else process.env.POC_LSP_COUNTER = priorCounter;
  fs.rmSync(container, { recursive: true, force: true });
}
