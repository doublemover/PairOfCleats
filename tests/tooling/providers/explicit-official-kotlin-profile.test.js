import assert from 'node:assert/strict';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import { normalizeServerConfig, collectAutoPresetServers } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { selectToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { resolveWorkspaceExecutionAuthority } from '../../../src/shared/workspace-execution-authority.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// UNVALIDATED source/selection/negative-flow regression. No official executable,
// workspace import, native semantic source admission or published proof implied.
const lang = getLanguageForFile('.kt', 'src/Main.kt');
assert.equal(lang.id, 'kotlin');
const preset = resolveLspServerPresetByKey('kotlin-official');
assert.equal(preset.id, 'kotlin-lsp'); assert.equal(preset.explicitOnly, true);
assert.deepEqual(preset.args, ['--stdio']);
assert.ok(!collectAutoPresetServers({ autoEnableOnDetect: true }, new Set()).some(value => value.id === 'kotlin-lsp'));
const server = normalizeServerConfig({ preset: 'kotlin-official', id: 'renamed-kotlin', cmd: 'fixture-explicit-launcher' }, 0);
assert.equal(server.workspaceExecutionProfile, 'kotlin-lsp');
const provider = createConfiguredLspProvider(server);
const documents = [
  { virtualPath: 'Main.kt', containerPath: 'src/Main.kt', languageId: lang.id, text: 'fun greet() = "hé😀"\n' },
  { virtualPath: 'build.gradle.kts', containerPath: 'build.gradle.kts', languageId: lang.id, text: 'plugins {}' }
];
const targets = documents.map(value => ({ virtualPath: value.virtualPath, languageId: value.languageId }));
assert.deepEqual(provider.preparePreflightInputs({}, { documents, targets }).documents.map(value => value.virtualPath), ['Main.kt']);
const plans = selectToolingProviders({ toolingConfig: { lsp: { servers: [{ preset: 'kotlin-official', id: 'selected-kotlin' }] } }, documents, targets });
assert.ok(plans.some(value => value.provider.id === 'lsp-selected-kotlin' && value.documents.some(document => document.virtualPath === 'Main.kt')));
await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
  const denied = await provider.preflight({ repoRoot: process.cwd(), toolingConfig: {} }, { documents, targets });
  assert.equal(denied.reasonCode, 'kotlin_workspace_trust_required', 'renaming both executable and id preserves canonical selected-profile authority');
  const blocked = await provider.run({ repoRoot: process.cwd(), toolingConfig: {} }, { documents, targets });
  assert.ok(blocked.diagnostics.checks.some(value => value.name === 'kotlin_workspace_trust_required'));
  const disabled = await provider.run({ repoRoot: process.cwd(), toolingConfig: { lsp: { enabled: false } } }, { documents, targets });
  assert.deepEqual(disabled.byChunkUid, {});
  const ruby = normalizeServerConfig({ preset: 'ruby-lsp', id: 'renamed-ruby', cmd: 'fixture-renamed-ruby' }, 1);
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: process.cwd(), server: ruby }).reasonCode, 'ruby_workspace_trust_required');
});
await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([process.cwd()]) }, async () => {
  assert.equal((await provider.preflight({ repoRoot: process.cwd(), toolingConfig: {} }, {
    documents: documents.slice(1), targets: targets.slice(1)
  })).reasonCode, 'kotlin_lsp_no_admitted_sources', 'unsupported scripts block before command probes');
  const retired = createConfiguredLspProvider(normalizeServerConfig({ preset: 'kotlin-language-server', id: 'old-kotlin' }, 0));
  assert.equal((await retired.preflight({ repoRoot: process.cwd(), toolingConfig: {} })).reasonCode, 'kotlin_fwcd_migration_required');
  const result = await retired.run({ repoRoot: process.cwd(), toolingConfig: {} }, { documents, targets });
  assert.ok(result.diagnostics.checks.some(value => value.name === 'kotlin_fwcd_migration_required'));
});
console.log('Official Kotlin opt-in selection and existing source routing preserve trust, script exclusion and retired-product diagnostics');
