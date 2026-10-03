// Opt-in Java acceptance. Install and verify official JDT LS separately; runs one owned fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLspClient, pathToFileUri } from '../../../src/integrations/tooling/lsp/client.js';
import { createLspConfigurationHandler } from '../../../src/integrations/tooling/lsp/configuration.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { createJdtlsProvider } from '../../../src/index/tooling/jdtls-provider.js';
import { parseJavaSignature } from '../../../src/index/tooling/signature-parse/java.js';
import { resolveWorkspaceExecutionAuthority } from '../../../src/shared/workspace-execution-authority.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';

const [mode, suppliedJava, suppliedInstall] = process.argv.slice(2);
assert.ok(['client', 'common', 'dedicated'].includes(mode));
assert.ok(path.isAbsolute(suppliedJava) && path.isAbsolute(suppliedInstall));
const java = fs.realpathSync(suppliedJava);
const install = fs.realpathSync(suppliedInstall);
const launcherNames = fs.readdirSync(path.join(install, 'plugins')).filter((name) => /^org\.eclipse\.equinox\.launcher_[A-Za-z0-9_.-]+\.jar$/u.test(name));
assert.equal(launcherNames.length, 1);
const launcher = path.join(install, 'plugins', launcherNames[0]);
const coreNames = fs.readdirSync(path.join(install, 'plugins')).filter((name) => /^org\.eclipse\.jdt\.ls\.core_[A-Za-z0-9_.-]+\.jar$/u.test(name));
assert.deepEqual(coreNames, ['org.eclipse.jdt.ls.core_1.61.0.202609031315.jar'], 'This fixture records the verified 1.61.0 milestone');
const core = path.join(install, 'plugins', coreNames[0]);
const container = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-jdtls-'));
const root = path.join(container, 'workspace');
const home = path.join(container, 'home');
fs.mkdirSync(root);
fs.mkdirSync(home);
const configuration = path.join(home, 'configuration');
fs.cpSync(path.join(install, 'config_linux'), configuration, { recursive: true });
const data = path.join(home, 'workspace-data');
const text = 'class App {\n  static int add(int a, int b) { return a + b; }\n  static int example() { return add(2, 3); }\n}\n';
const file = path.join(root, 'App.java');
fs.writeFileSync(file, text);
const settings = { java: { autobuild: { enabled: false }, import: {
  gradle: { enabled: false, wrapper: { enabled: false }, offline: { enabled: true }, annotationProcessing: { enabled: false } },
  maven: { enabled: false, offline: { enabled: true } } }, configuration: { updateBuildConfiguration: 'disabled' },
  maven: { downloadSources: false }, eclipse: { downloadSources: false }, telemetry: { enabled: false } } };
const initializationOptions = { settings };
const scopedRuntime = { timeoutMs: 15000, softDeadlineMs: 24000, hoverTimeoutMs: 8000,
  retries: 0, strict: false, hoverMaxPerFile: 1, documentSymbolConcurrency: 1, hoverConcurrency: 1,
  semanticTokensEnabled: false, signatureHelpEnabled: false, inlayHintsEnabled: false,
  definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false };
const env = { PATH: `${path.dirname(java)}:/usr/bin:/bin`, JAVA_HOME: path.dirname(path.dirname(java)),
  HOME: home, TMPDIR: home, XDG_CACHE_HOME: path.join(home, 'cache'), XDG_CONFIG_HOME: path.join(home, 'config'),
  PAIROFCLEATS_EMBEDDINGS: 'off', PAIROFCLEATS_THREADS: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
const args = ['-Xms32m', '-Xmx256m', '-XX:MaxMetaspaceSize=128m', '-XX:ReservedCodeCacheSize=64m',
  '-XX:ActiveProcessorCount=1', '-XX:+UseSerialGC',
  '-Duser.home=' + home, '-Djava.io.tmpdir=' + home, '-Dosgi.install.area=' + install,
  '-Declipse.application=org.eclipse.jdt.ls.core.id1', '-Dosgi.bundles.defaultStartLevel=4',
  '-Declipse.product=org.eclipse.jdt.ls.core.product', '-Dlog.level=ERROR',
  '--add-modules=ALL-SYSTEM', '--add-opens', 'java.base/java.util=ALL-UNNAMED',
  '--add-opens', 'java.base/java.lang=ALL-UNNAMED', '-jar', launcher,
  '-configuration', configuration, '-data', data];
const priorEnv = { ...process.env };
let client;
try {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: root, providerId: 'jdtls' }).reasonCode, 'java_workspace_trust_required');
  const uid = 'ck64:v1:test:java:jdtls-live';
  const methodStart = text.indexOf('  static int add');
  const methodEnd = text.indexOf('\n', methodStart);
  const inputs = { documents: [{ virtualPath: 'App.java', text, languageId: 'java', effectiveExt: '.java' }],
    targets: [{ chunkRef: { docId: 0, chunkUid: uid, chunkId: 'jdtls-live', file: 'App.java',
      range: { start: methodStart, end: methodEnd } }, virtualPath: 'App.java',
    virtualRange: { start: methodStart, end: methodEnd }, symbolHint: { name: 'App.add', kind: 'method' } }], kinds: ['types'] };
  const denied = await collectLspTypes({ rootDir: root, cmd: java, args, providerId: 'jdtls', ...inputs });
  assert.equal(denied.runtime.executionAuthority.reasonCode, 'java_workspace_trust_required');
  assert.equal(fs.existsSync(data), false);
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([root]);
  assert.equal(resolveWorkspaceExecutionAuthority({ repoRoot: root, providerId: 'jdtls' }), null);
  const runtime = execFileSync(java, ['--version'], { cwd: home, env, timeout: 5000, encoding: 'utf8' }).trim();
  let observations;
  if (mode === 'client') {
    client = createLspClient({ cmd: java, args, cwd: root, env, providerId: 'jdtls',
      onRequest: createLspConfigurationHandler({ settings }) });
    await client.initialize({ rootUri: pathToFileUri(root), workspaceFolders: [{ uri: pathToFileUri(root), name: 'isolated-fixture' }],
      initializationOptions, capabilities: { workspace: { configuration: true }, textDocument: {
        documentSymbol: { hierarchicalDocumentSymbolSupport: true }, hover: { contentFormat: ['plaintext', 'markdown'] } } }, timeoutMs: 15000 });
    const uri = pathToFileUri(file);
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'java', version: 1, text } });
    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs: 5000 });
    assert.match(JSON.stringify(symbols), /add/);
    const position = { line: 2, character: text.split('\n')[2].indexOf('add') + 1 };
    const hover = await client.request('textDocument/hover', { textDocument: { uri }, position }, { timeoutMs: 5000 });
    assert.match(JSON.stringify(hover), /add/);
    const javaHover = hover.contents.find((content) => content?.language === 'java')?.value;
    const parsedHover = parseJavaSignature(javaHover, 'App.add(int, int)');
    assert.equal(parsedHover?.returnType, 'int');
    assert.deepEqual(parsedHover?.paramTypes, { a: 'int', b: 'int' });
    const definition = await client.request('textDocument/definition', { textDocument: { uri }, position }, { timeoutMs: 5000 });
    const locations = Array.isArray(definition) ? definition : definition ? [definition] : [];
    assert.ok(locations.some((location) => (location.uri || location.targetUri) === uri));
    observations = { actualPoCClient: true, symbols: true, hover: true, sameFileDefinition: true,
      serverHoverReturnType: parsedHover.returnType, serverHoverParameterTypes: parsedHover.paramTypes };
  } else {
    const collected = mode === 'common'
      ? await collectLspTypes({ rootDir: root, cmd: java, args, providerId: 'jdtls', ...inputs,
        parseSignature: (detail, _language, name) => parseJavaSignature(detail, name),
        initializationOptions, sessionPoolingEnabled: false, vfsColdStartCache: false, uriScheme: 'file',
        ...scopedRuntime })
      : await createJdtlsProvider().run({ repoRoot: root, buildRoot: home, strict: false,
        cache: { enabled: false, dir: path.join(home, 'poc-cache') },
        toolingConfig: { jdtls: { enabled: true, cmd: java, args, workspaceDataDir: data, requireWorkspaceModel: false,
          initializationOptions, ...scopedRuntime, vfsColdStartCache: false, uriScheme: 'file' } } }, inputs);
    assert.equal(collected.byChunkUid[uid]?.payload?.returnType, 'int');
    const provenance = collected.byChunkUid[uid].provenance;
    observations = { actualPoCCollector: true, actualDedicatedAdapter: mode === 'dedicated', collectedReturnType: 'int',
      typeEvidenceTier: provenance?.evidence?.tier, sourceBootstrapUsed: provenance?.stages?.sourceBootstrapUsed,
      serverHoverUsed: provenance?.stages?.hover?.succeeded,
      runtimePrerequisiteChecks: (collected.checks || collected.diagnostics?.checks || []).map((check) => check.name) };
  }
  console.log(JSON.stringify({ server: 'jdtls', version: '1.61.0.202609031315', mode, javaRuntime: runtime,
    javaBinarySha256: createHash('sha256').update(fs.readFileSync(java)).digest('hex'),
    launcherSha256: createHash('sha256').update(fs.readFileSync(launcher)).digest('hex'),
    coreSha256: createHash('sha256').update(fs.readFileSync(core)).digest('hex'),
    ...observations, fixtureOnlyGrant: true, gradleImport: false, mavenImport: false,
    gradleAnnotationProcessing: false, mavenAnnotationProcessingRoute: 'import-disabled',
    autobuild: false, modelWork: false, fullIndexing: false }));
} finally {
  await client?.shutdownAndExit();
  client?.killSync();
  await __testLspSessionPool.reset();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, priorEnv);
  fs.rmSync(container, { recursive: true, force: true });
}
