import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildKotlinChunks } from '../../../src/lang/kotlin.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { runToolingPass } from '../../../src/index/type-inference-crossfile/tooling.js';
import { parseKotlinSignature } from '../../../src/index/tooling/signature-parse/kotlin.js';
import { createLspProviderTempRepo, resolveLspStubServerPath } from '../../helpers/lsp-provider-fixture.js';
import { grantFixtureRepositoryExecution } from '../../helpers/execution-authority.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';

const generic = parseKotlinSignature('public suspend fun <T : Comparable<T>> List<T>.map(value: Map<String, List<T?>>, transform: suspend (T) -> Pair<String, T?>): List<Pair<String, T?>> where T : Any');
assert.equal(generic.returnType, 'List<Pair<String, T?>>');
assert.deepEqual(generic.paramNames, ['value', 'transform']);
assert.equal(generic.paramTypes.value, 'Map<String, List<T?>>');
assert.equal(generic.paramTypes.transform, 'suspend (T) -> Pair<String, T?>');
assert.equal(parseKotlinSignature('fun compare(ok: Boolean = 1 < 2, name: String = "a,b"): Boolean').paramTypes.name, 'String');
assert.equal(parseKotlinSignature('fun greet(vararg names: String, noinline action: () -> Unit): Unit').paramTypes.action, '() -> Unit');
assert.equal(parseKotlinSignature('fun `name with spaces`(`when`: String?): String?').paramTypes['`when`'], 'String?');
assert.equal(Object.hasOwn(parseKotlinSignature('fun safe(__proto__: String): String').paramTypes, '__proto__'), true);
assert.equal(parseKotlinSignature('fun inferred(value: String)').returnType, null, 'missing return display stays unknown');
for (const unsupported of ['class Example(value: String)', 'fun broken(value: String',
  'fun untyped(value): String', 'fun duplicate(value: Int, value: String): String',
  'fun body(): String = "inferred"', 'fun missing():', 'fun bad(value: Map<A, B): Unit']) {
  assert.equal(parseKotlinSignature(unsupported), null, `unsupported or malformed signature: ${unsupported}`);
}

const source = 'suspend fun greet(name: String, transform: (String) -> String?): Map<String, String?> {\n  return mapOf(name to transform(name))\n}\n';
const filename = 'app/src/main/kotlin/Main.kt';
const repoRoot = await createLspProviderTempRepo({ name: 'kotlin-retained-signatures', files: [
  { path: 'settings.gradle.kts', content: 'rootProject.name = "fixture"\ninclude(":app")\n' },
  { path: 'app/build.gradle.kts', content: 'plugins { kotlin("jvm") }\n' },
  { path: filename, content: source }
] });
const restoreTrust = grantFixtureRepositoryExecution(repoRoot);
try {
  const language = getLanguageForFile('.kt', filename);
  assert.equal(language.id, 'kotlin');
  const chunks = buildKotlinChunks(await fs.readFile(path.join(repoRoot, filename), 'utf8')).map((chunk, index) => ({
    ...chunk, file: filename, ext: '.kt', lang: language.id,
    chunkUid: `ck64:v1:test:kotlin-retained:${index}`, chunkId: `kotlin-retained-${index}`, docmeta: {}
  }));
  const greet = chunks.find(chunk => chunk.name === 'greet');
  assert.ok(greet, 'ordinary Kotlin chunking supplies the provider target');
  const stats = await runToolingPass({
    rootDir: repoRoot, buildRoot: repoRoot, chunks, entryByUid: new Map(), log: () => {},
    fileTextByFile: new Map([[filename, source]]), toolingTimeoutMs: 3000, toolingRetries: 0,
    toolingBreaker: 2, toolingConfig: { enabledTools: ['lsp-kotlin-retained'], cache: { enabled: false },
      lsp: { enabled: true, servers: [{ id: 'kotlin-retained', preset: 'kotlin-lsp',
        cmd: process.execPath, args: [resolveLspStubServerPath(), '--mode', 'kotlin-function'],
        uriScheme: 'poc-vfs', hoverEnabled: false, definitionEnabled: false, referencesEnabled: false,
        typeDefinitionEnabled: false, inlayHintsEnabled: false, semanticTokensEnabled: false }] } }
  });
  assert.equal(stats.toolingProvidersExecuted, 1);
  assert.equal(stats.toolingProvidersContributed, 1);
  assert.equal(greet.docmeta.returnType, 'Map<String, String?>', 'real tooling pass retains the server return presentation');
  assert.equal(greet.docmeta.paramTypes.name, 'String');
  assert.equal(greet.docmeta.paramTypes.transform, '(String)->String?');
  assert.ok(greet.docmeta.inferredTypes.returns.some(value => value.type === 'Map<String, String?>'));
  assert.ok(greet.docmeta.inferredTypes.params.transform.some(value => value.type === '(String)->String?'));
} finally {
  restoreTrust();
  await cleanupLspTestRuntime({ reason: 'kotlin_retained_signatures', strict: true });
  await fs.rm(repoRoot, { recursive: true, force: true });
}
console.log('Kotlin function presentation reaches ordinary chunk and tooling-pass consumers; official server remains unqualified');
