import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSourcekitProvider } from '../../../src/index/tooling/sourcekit-provider.js';
import { ensureSourcekitPackageResolutionPreflight } from '../../../src/index/tooling/preflight/sourcekit-package-resolution.js';
import { createSourcekitOperationPlan, verifySourcekitOperationPlan } from '../../../src/index/tooling/preflight/sourcekit-operation-plan.js';
import { buildSwiftChunks } from '../../../src/lang/swift.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { createLspProviderTempRepo, resolveLspStubServerPath } from '../../helpers/lsp-provider-fixture.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';

// Authored actual-consumer regression. No Swift/compiler/runtime acceptance or
// feature checks were executed while the parallel wave was writing.
const fixture = await createSourcekitPreflightFixture({ root: process.cwd(), name: 'sourcekit-passive-admission', includeDependencies: true });
const { ctx, document, target } = fixture.contextFor([]);
const provider = createSourcekitProvider();
try {
  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    const passive = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.equal(passive.diagnostics.fidelity.state, 'blocked');
    assert.equal(passive.diagnostics.preflight.reasonCode, 'sourcekit_package_resolution_required');
    assert.equal(await countNonEmptyLines(fixture.counterPath), 0);
    await assert.rejects(fs.access(fixture.markerPath), { code: 'ENOENT' }, 'passive preflight cannot publish resolving cache state');
    const forged = await ensureSourcekitPackageResolutionPreflight({ repoRoot: fixture.tempRoot, log: () => {},
      sourcekitConfig: { preflightFailOpen: true }, resolutionPlan: { schemaVersion: 1, identity: 'fake' } });
    assert.equal(forged.blockSourcekit, true, 'fail-open is not operation authority');
    assert.equal(forged.reasonCode, 'sourcekit_operation_plan_invalid');
    await fixture.authorizeOperations(ctx);
    assert.ok(await verifySourcekitOperationPlan(ctx.sourcekitOperationPlan, { repoRoot: fixture.tempRoot }));
    const manifestPath = path.join(fixture.tempRoot, 'Package.swift');
    const before = await fs.readFile(manifestPath, 'utf8');
    await fs.appendFile(manifestPath, '\n// a new reviewed source generation is required\n');
    await assert.rejects(verifySourcekitOperationPlan(ctx.sourcekitOperationPlan, { repoRoot: fixture.tempRoot }), { code: 'ERR_SOURCEKIT_OPERATION_PLAN' });
    await fs.writeFile(manifestPath, before);
    await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
      await assert.rejects(createSourcekitOperationPlan({ repoRoot: fixture.tempRoot,
        swiftCommand: path.join(fixture.binDir, process.platform === 'win32' ? 'swift.cmd' : 'swift'), allowWorkspaceLoad: true }), { code: 'ERR_SOURCEKIT_OPERATION_PLAN' });
      const denied = await provider.preflight(ctx, { documents: [document], targets: [target] });
      assert.equal(denied.reasonCode, 'sourcekit_workspace_trust_required');
    });
    assert.equal(await countNonEmptyLines(fixture.counterPath), 0, 'creating/verifying authority never resolves packages');
  });
  for (const blocked of [{ state: 'blocked', reasonCode: 'generic_blocked' },
    { state: 'degraded', blockProvider: true, reasonCode: 'optional_timeout_teardown_pending' }]) {
    const current = createSourcekitProvider();
    current.preflight = async () => blocked;
    const output = await current.run({ repoRoot: ctx.repoRoot, buildRoot: ctx.buildRoot, toolingConfig: ctx.toolingConfig,
      sourcekitOperationPlan: ctx.sourcekitOperationPlan }, { documents: [document], targets: [target] });
    assert.deepEqual(output.byChunkUid, {});
    assert.equal(output.diagnostics.fidelity.state, 'blocked');
    assert.equal(output.diagnostics.preflight.reasonCode, blocked.reasonCode);
  }
} finally {
  await cleanupLspTestRuntime({ reason: 'sourcekit_passive_operation', strict: true });
  await fixture.restorePath();
}

const source = 'func greet(name: String, count: Int) -> String { return name }\n';
const filename = 'src/Greet.swift';
const root = await createLspProviderTempRepo({ name: 'swift-configured-retained', files: [{ path: filename, content: source }] });
const restoreExecution = grantFixtureRepositoryExecution(root);
try {
  const language = getLanguageForFile('.swift', filename);
  const chunks = buildSwiftChunks(source).map((chunk, index) => ({ ...chunk, file: filename, ext: '.swift', lang: language.id,
    chunkUid: `ck64:v1:test:swift-retained:${index}`, chunkId: `swift-retained-${index}`, docmeta: {} }));
  const greet = chunks.find(chunk => chunk.name === 'greet');
  assert.ok(greet, 'ordinary Swift chunking provides the target');
  const stats = await runToolingPass({ rootDir: root, buildRoot: root, chunks, entryByUid: new Map(), log: () => {},
    fileTextByFile: new Map([[filename, source]]), toolingTimeoutMs: 3000, toolingRetries: 0, toolingBreaker: 2,
    toolingConfig: { enabledTools: ['lsp-sourcekit'], cache: { enabled: false }, lsp: { enabled: true, servers: [{ id: 'sourcekit',
      languages: ['swift'], cmd: process.execPath, args: [resolveLspStubServerPath(), '--mode', 'sourcekit-passive'],
      hoverEnabled: false, definitionEnabled: false, referencesEnabled: false, typeDefinitionEnabled: false }] } } });
  assert.equal(stats.toolingProvidersContributed, 1);
  assert.equal(greet.docmeta.returnType, 'String');
  assert.equal(greet.docmeta.paramTypes.count, 'Int');
  assert.ok(greet.docmeta.inferredTypes.params.name.some(entry => entry.type === 'String'));
} finally {
  restoreExecution();
  await cleanupLspTestRuntime({ reason: 'swift_configured_retained', strict: true });
  await fs.rm(root, { recursive: true, force: true });
}
console.log('SourceKit passive work blocks side effects; explicit operation authority and generic Swift retained consumers remain separate');
