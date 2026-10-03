import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveWorkspaceExecutionAuthority } from '../../src/shared/workspace-execution-authority.js';
import { createConfiguredLspProvider } from '../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../src/index/tooling/lsp-provider/normalize.js';
import { resolveToolingCommandProfile } from '../../src/index/tooling/command-resolver.js';
import { resolveRuntimeRequirementsPreflight } from '../../src/index/tooling/preflight/runtime-requirements-preflight.js';
import { collectConfiguredOutput } from '../../src/index/tooling/lsp-provider/runtime.js';
import { collectLspTypes } from '../../src/integrations/tooling/providers/lsp.js';
import { getToolingRegistry } from '../../tools/tooling/utils.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-zig-authority-'));
const repo = path.join(root, 'repo');
const outside = path.join(root, 'outside');
fs.mkdirSync(repo);
fs.mkdirSync(outside);
fs.mkdirSync(path.join(repo, 'nested'));
const text = 'pub fn add(a: i32, b: i32) i32 { return a + b; }\n';
fs.writeFileSync(path.join(repo, 'sample.zig'), text);
const counter = path.join(root, 'counter');
const priorTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS;
const priorCounter = process.env.POC_LSP_COUNTER;
const stub = path.resolve('tests/fixtures/lsp/stub-lsp-server.js');
const server = normalizeServerConfig({ id: 'zls-safe-fixture', languages: ['zig'],
  cmd: process.execPath, args: [stub, '--mode', 'zig', '--exit-on-shutdown'], requireWorkspaceModel: false }, 0);
const provider = createConfiguredLspProvider(server);
const ctx = { repoRoot: repo, toolingConfig: { lsp: { enabled: true } }, trusted: true };
const inputs = { documents: [{ virtualPath: 'sample.zig', text, languageId: 'zig', effectiveExt: '.zig' }],
  targets: [{ chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:zig:authority', chunkId: 'zig-authority',
    file: 'sample.zig', range: { start: 0, end: text.length } }, virtualPath: 'sample.zig',
  virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'add', kind: 'function' } }], kinds: ['types'] };
try {
  delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  process.env.POC_LSP_COUNTER = counter;
  fs.writeFileSync(path.join(repo, '.pairofcleats.json'), JSON.stringify({ trusted: true }));
  const untrustedHash = provider.getConfigHash(ctx);
  assert.equal((await provider.preflight(ctx, inputs)).reasonCode, 'zig_workspace_trust_required');
  const profile = resolveToolingCommandProfile({ providerId: 'zls', cmd: process.execPath, args: [stub], repoRoot: repo });
  assert.equal(profile.resolved.mode, 'blocked');
  assert.deepEqual(profile.probe.attempted, []);
  assert.equal(resolveRuntimeRequirementsPreflight({ ctx, providerId: 'zls',
    requirements: [{ id: 'zig', cmd: process.execPath, args: [stub] }] }).blockProvider, true);
  assert.deepEqual((await provider.run(ctx, inputs)).byChunkUid, {});
  const direct = await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath, args: [stub],
    providerId: 'custom-alias', sessionPoolingEnabled: false });
  assert.equal(direct.runtime.executionAuthority.reasonCode, 'zig_workspace_trust_required');
  assert.equal((await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath, args: [stub],
    collectTypes: false, captureDiagnostics: true })).runtime.executionAuthority.reasonCode, 'zig_workspace_trust_required');
  assert.ok((await collectConfiguredOutput({ server, providerId: provider.id, ctx, provider,
    docs: inputs.documents, targets: inputs.targets })).checks.some((check) => check.name === 'zig_workspace_trust_required'));
  assert.equal(fs.existsSync(counter), false, 'no denied probe or workspace launch');
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([root]);
  assert.ok(resolveWorkspaceExecutionAuthority({ repoRoot: repo, providerId: 'zls' }));
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: path.join(repo, 'nested'), server }), null);
  assert.ok(resolveWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: outside, server }));
  assert.notEqual(provider.getConfigHash(ctx), untrustedHash);
  provider.preflight = async () => {
    delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
    return { state: 'ready' };
  };
  assert.deepEqual((await provider.run(ctx, inputs)).byChunkUid, {});
  assert.equal(fs.existsSync(counter), false, 'pending preflight cannot retain a revoked grant');
  assert.equal(getToolingRegistry(path.join(root, 'tool-cache'), repo).find((tool) => tool.id === 'zls').install.manual, true);
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  const allowed = await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath, args: server.args,
    providerId: 'zls', sessionPoolingEnabled: false, vfsColdStartCache: false, timeoutMs: 3000, retries: 0, strict: false });
  assert.ok(!allowed.checks.some((check) => check.name === 'zig_workspace_trust_required'));
  assert.ok(fs.readFileSync(counter, 'utf8').includes('spawn'));
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: repo, providerId: 'yaml-language-server' }), null);
  console.log('Exact Zig workspace grants guard build-runner-capable tooling without granting installation authority');
} finally {
  if (priorTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrust;
  if (priorCounter === undefined) delete process.env.POC_LSP_COUNTER;
  else process.env.POC_LSP_COUNTER = priorCounter;
  fs.rmSync(root, { recursive: true, force: true });
}
