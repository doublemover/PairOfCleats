import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parsePhpSignature } from '../../../src/index/tooling/signature-parse/php.js';
import { inspectComposerManifest, resolvePhpactorComposerPreflight } from '../../../src/index/tooling/preflight/phpactor-composer.js';
import { createPhpactorProvider } from '../../../src/index/tooling/phpactor-provider.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { buildPhpChunks } from '../../../src/lang/php.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { createLspProviderTempRepo, resolveLspStubServerPath } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

// Authored against upstream Phpactor function/parameter formatters. No server,
// runtime, or feature check was executed while the parallel wave was writing.
const generic = parsePhpSignature('public static function greet(list<\\Domain\\User> &$users, ?callable $format = null): array<string, \\Domain\\User|null>');
assert.deepEqual(generic.paramNames, ['users', 'format']);
assert.equal(generic.paramTypes.users, 'list<\\Domain\\User>');
assert.equal(generic.paramTypes.format, '?callable');
assert.equal(generic.returnType, 'array<string, \\Domain\\User|null>');
assert.equal(parsePhpSignature('greet(array{key: string, item: list<int>} $values): (A&B)|null').returnType, '(A&B)|null');
assert.deepEqual(parsePhpSignature('function unknown($value)').paramTypes, {});
assert.equal(parsePhpSignature('function unknown($value)').returnType, null);
assert.equal(parsePhpSignature('<?php function café(string $名, bool $ok = 1 < 2): string').paramTypes['名'], 'string');
assert.equal(parsePhpSignature('function safe(string $__proto__): string').paramTypes.__proto__, 'string');
for (const unsupported of ['class Example {}', 'function broken(string $a', 'function x(string $a, int $a): void',
  'function x(string name): string', 'function x():', 'function x(): string { return "x"; }']) {
  assert.equal(parsePhpSignature(unsupported), null, `malformed or unsupported signature: ${unsupported}`);
}
for (const invalid of [[], null, { autoload: [] }, { autoload: { 'psr-4': [] } },
  { autoload: { files: 'bootstrap.php' } }, { autoload: { 'psr-4': { 'App\\': 7 } } },
  { require: ['bad'] }, { config: { 'vendor-dir': null } }]) {
  assert.throws(() => inspectComposerManifest(invalid), { code: 'ERR_COMPOSER_MANIFEST_INVALID' });
}

const filename = 'packages/app/src/Example.php';
const source = '<?php\n/** @param list<\\Domain\\User> $users */\nfunction greet(array $users, ?callable $format = null): array { return []; }\n';
const root = await createLspProviderTempRepo({ name: 'phpactor-retained-context', files: [
  { path: filename, content: source },
  { path: 'packages/app/composer.json', content: JSON.stringify({ name: 'fixture/app', autoload: { 'psr-4': { 'App\\': 'src/' } } }) },
  { path: 'packages/app/composer.lock', content: JSON.stringify({ packages: [], 'packages-dev': [] }) },
  { path: 'packages/app/vendor/autoload.php', content: '<?php throw new Exception("fixture must never include this autoloader");' }
] });
const provider = createPhpactorProvider();
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    const ctx = { repoRoot: root, toolingConfig: { phpactor: { enabled: true, cmd: 'must-not-be-probed' } } };
    const denied = await provider.preflight(ctx, {});
    assert.equal(denied.reasonCode, 'phpactor_workspace_trust_required');
    assert.equal(denied.blockProvider, true);
    const renamed = createConfiguredLspProvider(normalizeServerConfig({ id: 'renamed-php', cmd: 'phpactor', languages: ['php'] }, 0));
    assert.match((await renamed.preflight({ repoRoot: root, toolingConfig: {} }, {})).reasonCode, /workspace_trust_required$/u);
  });
  const restore = grantFixtureRepositoryExecution(root);
  try {
    const language = getLanguageForFile('.php', filename);
    assert.equal(language.id, 'php');
    const chunks = buildPhpChunks(source).map((chunk, index) => ({ ...chunk, file: filename, ext: '.php', lang: language.id,
      chunkUid: `ck64:v1:test:phpactor-retained:${index}`, chunkId: `phpactor-retained-${index}`, docmeta: {} }));
    const greet = chunks.find(chunk => chunk.name === 'greet');
    assert.ok(greet, 'ordinary PHP chunking provides the target');
    const inputs = { documents: [{ virtualPath: filename, containerPath: filename }] };
    const preflight = await resolvePhpactorComposerPreflight({ ctx: { repoRoot: root }, inputs });
    assert.equal(preflight.state, 'ready');
    assert.equal(preflight.composerModels[0].workspace, 'packages/app');
    assert.equal(preflight.composerModels[0].dependencyClosure, 'unknown');
    const observed = preflight.composerModels[0].manifestHash;
    await fs.writeFile(path.join(root, 'packages/app/composer.json'), JSON.stringify({
      name: 'fixture/app', autoload: { 'psr-4': { 'App\\': ['src/', 'generated/'] } }
    }));
    assert.notEqual((await resolvePhpactorComposerPreflight({ ctx: { repoRoot: root }, inputs })).composerModels[0].manifestHash, observed);
    const stats = await runToolingPass({ rootDir: root, buildRoot: root, chunks, entryByUid: new Map(), log: () => {},
      fileTextByFile: new Map([[filename, source]]), toolingTimeoutMs: 3000, toolingRetries: 0, toolingBreaker: 2,
      toolingConfig: { enabledTools: ['phpactor'], cache: { enabled: false }, phpactor: { enabled: true,
        cmd: process.execPath, args: [resolveLspStubServerPath(), '--mode', 'php-generics', 'language-server'],
        hoverEnabled: false, definitionEnabled: false, referencesEnabled: false, typeDefinitionEnabled: false } }
    });
    assert.equal(stats.toolingProvidersContributed, 1);
    assert.equal(greet.docmeta.paramTypes.users, 'list<\\Domain\\User>');
    assert.equal(greet.docmeta.returnType, 'array<string, \\Domain\\User | null>');
    assert.ok(greet.docmeta.inferredTypes.params.format.some(entry => entry.type === '?callable'));
    const diagnosticPath = path.join(root, '.build/pairofcleats/tooling-cache/diagnostics/tooling.json');
    const diagnostics = JSON.parse(await fs.readFile(diagnosticPath, 'utf8'));
    assert.ok(diagnostics.providers.find(entry => entry.providerId === 'phpactor').checks.some(check => check.name === 'phpactor_workspace_composer_model'));
  } finally { restore(); }
} finally {
  await cleanupLspTestRuntime({ reason: 'phpactor_retained_context', strict: true });
  await fs.rm(root, { recursive: true, force: true });
}
console.log('PHP signature/Composer context reaches retained consumers with project execution authority intact');
