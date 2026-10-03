import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isRepoTrusted } from '../../src/shared/config-authority.js';
import { resolveRustWorkspaceExecutionAuthority } from '../../src/shared/workspace-execution-authority.js';
import { createConfiguredLspProvider } from '../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../src/index/tooling/lsp-provider/normalize.js';
import { resolveToolingCommandProfile } from '../../src/index/tooling/command-resolver.js';
import { resolveRustWorkspaceMetadataPreflight } from '../../src/index/tooling/preflight/rust-workspace-preflight.js';
import { resolveRuntimeRequirementsPreflight } from '../../src/index/tooling/preflight/runtime-requirements-preflight.js';
import { collectConfiguredOutput } from '../../src/index/tooling/lsp-provider/runtime.js';
import { collectLspTypes } from '../../src/integrations/tooling/providers/lsp.js';
import { buildTreeSitterChunks } from '../../src/lang/tree-sitter/chunking.js';
import { getToolingRegistry } from '../../tools/tooling/utils.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-rust-authority-'));
const repo = path.join(root, 'repo');
const outside = path.join(root, 'outside');
fs.mkdirSync(repo);
fs.mkdirSync(outside);
fs.mkdirSync(path.join(repo, 'nested'));
fs.writeFileSync(path.join(repo, 'Cargo.toml'), '[package]\nname="tiny"\nversion="0.0.0"\nedition="2021"\n');
const text = 'pub fn double(x: i32) -> i32 { x * 2 }\n';
fs.writeFileSync(path.join(repo, 'sample.rs'), text);
const counter = path.join(root, 'counter');
const priorTrust = process.env.PAIROFCLEATS_TRUSTED_REPOS;
const priorCounter = process.env.POC_LSP_COUNTER;
const stub = path.resolve('tests/fixtures/lsp/stub-lsp-server.js');
const server = normalizeServerConfig({
  id: 'rust-safe-fixture', languages: ['rust'], cmd: process.execPath,
  args: [stub, '--mode', 'rust', '--exit-on-shutdown'], requireWorkspaceModel: false
}, 0);
const provider = createConfiguredLspProvider(server);
const ctx = { repoRoot: repo, toolingConfig: { lsp: { enabled: true } }, trusted: true };
const chunkUid = 'ck64:v1:test:rust:authority';
const inputs = {
  documents: [{ virtualPath: 'sample.rs', text, languageId: 'rust', effectiveExt: '.rs' }],
  targets: [{
    chunkRef: { docId: 0, chunkUid, chunkId: 'rust-authority', file: 'sample.rs', segmentUid: null,
      segmentId: null, range: { start: 0, end: text.length } },
    virtualPath: 'sample.rs', virtualRange: { start: 0, end: text.length },
    symbolHint: { name: 'double', kind: 'function' }
  }], kinds: ['types']
};
try {
  delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  process.env.POC_LSP_COUNTER = counter;
  fs.writeFileSync(path.join(repo, '.pairofcleats.json'), JSON.stringify({ trusted: true }));
  const untrustedHash = provider.getConfigHash(ctx);
  const preflight = await provider.preflight(ctx, inputs);
  assert.equal(preflight.blockProvider, true);
  assert.equal(preflight.reasonCode, 'rust_workspace_trust_required');
  const profile = resolveToolingCommandProfile({ providerId: 'rust-analyzer', cmd: process.execPath, args: [stub], repoRoot: repo });
  assert.equal(profile.resolved.mode, 'blocked');
  assert.deepEqual(profile.probe.attempted, []);
  const runtimePreflight = resolveRuntimeRequirementsPreflight({ ctx, providerId: 'rust-analyzer',
    requirements: [{ id: 'cargo', cmd: process.execPath, args: [stub] }] });
  assert.equal(runtimePreflight.blockProvider, true);
  assert.equal(runtimePreflight.reasonCode, 'rust_workspace_trust_required');
  const metadata = await resolveRustWorkspaceMetadataPreflight({ ctx, server, documents: inputs.documents });
  assert.equal(metadata.reasonCode, 'rust_workspace_trust_required');
  const blocked = await provider.run(ctx, inputs);
  assert.deepEqual(blocked.byChunkUid, {});
  assert.ok(blocked.diagnostics.checks.some((check) => check.name === 'rust_workspace_trust_required'));
  const direct = await collectLspTypes({ rootDir: repo, workspaceRootDir: repo,
    documents: inputs.documents, targets: inputs.targets, cmd: process.execPath, args: [stub],
    providerId: 'custom', sessionPoolingEnabled: false });
  assert.equal(direct.runtime.executionAuthority.state, 'blocked');
  assert.equal((await collectLspTypes({ rootDir: repo, ...inputs, cmd: process.execPath, args: [stub],
    collectTypes: false, captureDiagnostics: true })).runtime.executionAuthority.state, 'blocked');
  const bypass = await collectConfiguredOutput({ server, providerId: provider.id, ctx,
    provider, docs: inputs.documents, targets: inputs.targets });
  assert.ok(bypass.checks.some((check) => check.name === 'rust_workspace_trust_required'));
  assert.equal(fs.existsSync(counter), false, 'denied paths never start the benign stub or version probe');

  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([root]);
  assert.equal(isRepoTrusted(repo), false, 'parent-directory grants do not grant this repository');
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  assert.equal(resolveRustWorkspaceExecutionAuthority({ repoRoot: repo, providerId: 'rust-analyzer' }), null);
  assert.equal(resolveRustWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: path.join(repo, 'nested'), server }), null);
  assert.ok(resolveRustWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: outside, server }));
  fs.symlinkSync(outside, path.join(repo, 'escape'));
  assert.ok(resolveRustWorkspaceExecutionAuthority({ repoRoot: repo, workspaceRoot: path.join(repo, 'escape'), server }));
  assert.notEqual(provider.getConfigHash(ctx), untrustedHash, 'trust participates in cache/preflight identity');

  // A previously ready preflight must not survive a trust change while awaited.
  provider.preflight = async () => {
    delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
    return { state: 'ready', commandProfile: {
      requested: { cmd: process.execPath, args: server.args },
      resolved: { cmd: process.execPath, args: server.args, mode: 'direct' }, probe: { ok: true, attempted: [] }
    } };
  };
  assert.deepEqual((await provider.run(ctx, inputs)).byChunkUid, {});
  assert.equal(fs.existsSync(counter), false);
  assert.equal(provider.getConfigHash(ctx), untrustedHash);

  const chunks = buildTreeSitterChunks({ text, languageId: 'rust', ext: '.rs',
    options: { treeSitter: { enabled: true, strict: true, adaptive: false, chunkCache: false } } });
  assert.ok(chunks.some((chunk) => chunk.name === 'double'), 'native Rust AST does not need execution trust');
  const install = getToolingRegistry(path.join(root, 'tool-cache'), repo)
    .find((tool) => tool.id === 'rust-analyzer').install;
  assert.deepEqual(install.user.args, ['component', 'add', 'rust-analyzer'], 'installation remains a separate explicit action');

  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([repo]);
  const allowed = await collectLspTypes({ rootDir: repo, documents: inputs.documents, targets: inputs.targets,
    cmd: process.execPath, args: server.args, providerId: 'rust-analyzer', sessionPoolingEnabled: false,
    vfsColdStartCache: false, timeoutMs: 3000, retries: 0, strict: false });
  assert.ok(!allowed.checks.some((check) => check.name === 'rust_workspace_trust_required'));
  assert.ok(fs.readFileSync(counter, 'utf8').includes('spawn'), 'only the explicitly trusted benign stub is launched');
  console.log('Exact Rust repository grants guard probes, preflight, caches and launch; native AST stays available');
} finally {
  if (priorTrust === undefined) delete process.env.PAIROFCLEATS_TRUSTED_REPOS;
  else process.env.PAIROFCLEATS_TRUSTED_REPOS = priorTrust;
  if (priorCounter === undefined) delete process.env.POC_LSP_COUNTER;
  else process.env.POC_LSP_COUNTER = priorCounter;
  fs.rmSync(root, { recursive: true, force: true });
}
