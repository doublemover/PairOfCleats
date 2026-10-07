// Opt-in Python comparisons. Install and checksum-verify each tool separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLspClient, pathToFileUri } from '../../../src/integrations/tooling/lsp/client.js';
import { createLspConfigurationHandler } from '../../../src/integrations/tooling/lsp/configuration.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { createPyrightProvider } from '../../../src/index/tooling/pyright-provider.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';

const [server, suppliedInstallation] = process.argv.slice(2);
assert.ok(suppliedInstallation && path.isAbsolute(suppliedInstallation), 'Supply an absolute verified binary or node_modules root');
const installation = fs.realpathSync(suppliedInstallation);
assert.ok(['ty', 'ruff', 'pyright'].includes(server));
const binary = server === 'pyright' ? process.execPath : installation;
const entry = server === 'pyright' ? path.join(installation, 'pyright/dist/pyright-langserver.js') : binary;
const args = server === 'pyright' ? [entry, '--stdio'] : ['server'];
const container = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-python-lsp-'));
const root = path.join(container, 'workspace');
const home = path.join(container, 'home');
fs.mkdirSync(root);
fs.mkdirSync(home);
const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: home,
  XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'),
  RAYON_NUM_THREADS: '1', PAIROFCLEATS_EMBEDDINGS: 'off', PAIROFCLEATS_THREADS: '1',
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
const settings = server === 'ty' ? { ty: { diagnosticMode: 'openFilesOnly',
  inlayHints: { variableTypes: false, callArgumentNames: false }, completions: { autoImport: false } } }
  : server === 'pyright' ? { python: { analysis: { diagnosticMode: 'openFilesOnly',
    typeCheckingMode: 'basic', autoSearchPaths: false, useLibraryCodeForTypes: false } } }
  : { ruff: { fixAll: false, organizeImports: false, showSyntaxErrors: true } };
const initializationOptions = { settings, ...(server === 'ty'
  ? { untrustedWorkspace: true, experimental: { useUv: 'off' } } : {}) };
const onRequest = createLspConfigurationHandler(initializationOptions);
const text = 'def double(x: int) -> int:\n    return x * 2\n\nvalue = double(2)\nbad: int = "wrong"\nprint(missing)\n';
const file = path.join(root, 'sample.py');
const uri = pathToFileUri(file);
fs.writeFileSync(file, text);
const diagnostics = [];
const client = createLspClient({ cmd: binary, args, cwd: root, env, providerId: `${server}-acceptance`, onRequest,
  onNotification: (message) => {
    if (message.method === 'textDocument/publishDiagnostics' && message.params?.uri === uri) {
      diagnostics.splice(0, diagnostics.length, ...(message.params.diagnostics || []));
    }
  } });
const deadline = setTimeout(() => { client.killSync(); process.exitCode = 1; }, 30000);
const priorEnv = { ...process.env };
try {
  const version = server === 'pyright'
    ? JSON.parse(fs.readFileSync(path.join(installation, 'pyright/package.json'))).version
    : execFileSync(binary, ['--version'], { cwd: root, env, timeout: 5000, encoding: 'utf8' }).trim();
  const initialized = await client.initialize({ rootUri: pathToFileUri(root),
    workspaceFolders: [{ uri: pathToFileUri(root), name: 'tiny-fixture' }],
    capabilities: { workspace: { configuration: true }, textDocument: {
      hover: { contentFormat: ['plaintext', 'markdown'] }, publishDiagnostics: { relatedInformation: true } } },
    initializationOptions, timeoutMs: 5000 });
  const symbolCapability = Boolean(initialized.capabilities.documentSymbolProvider);
  client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'python', version: 1, text } });
  const result = { server, version, executableOrEntrypointSha256: createHash('sha256').update(fs.readFileSync(entry)).digest('hex'),
    actualPoCClient: true, initialized: true, advertisedDocumentSymbols: symbolCapability,
    safeUntrustedMode: server === 'ty', projectExecution: false, dependencyDownloads: 0,
    fullProviderPipeline: false, fullIndexing: false, modelWork: false };
  if (server !== 'ruff') {
    assert.ok(symbolCapability);
    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs: 5000 });
    assert.ok(symbols.some((symbol) => symbol.name === 'double'));
    const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: { line: 3, character: 10 } }, { timeoutMs: 5000 });
    assert.match(JSON.stringify(hover), /double/);
    const definition = await client.request('textDocument/definition', { textDocument: { uri }, position: { line: 3, character: 10 } }, { timeoutMs: 5000 });
    const locations = Array.isArray(definition) ? definition : definition ? [definition] : [];
    assert.ok(locations.some((location) => (location.uri || location.targetUri) === uri));
    Object.assign(result, { symbols: true, hover: true, definition: true });
  } else {
    assert.equal(symbolCapability, false);
    const formatting = await client.request('textDocument/formatting', { textDocument: { uri },
      options: { tabSize: 4, insertSpaces: true } }, { timeoutMs: 5000 });
    assert.ok(Array.isArray(formatting));
    Object.assign(result, { formatting: true, replacesTypeNavigation: false });
  }
  const ready = Date.now() + 5000;
  while (!diagnostics.length && Date.now() < ready) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(diagnostics.length, 'synthetic invalid assignment/undefined name should produce diagnostics');
  result.diagnostics = diagnostics.map((diagnostic) => ({ code: diagnostic.code, source: diagnostic.source, message: diagnostic.message }));
  await client.shutdownAndExit();
  client.killSync();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  const collected = await collectLspTypes({ rootDir: root, cmd: binary, args, providerId: server,
    documents: [{ virtualPath: 'sample.py', text, languageId: 'python', effectiveExt: '.py' }],
    targets: [{ chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:python:acceptance', chunkId: 'python-acceptance',
      file: 'sample.py', range: { start: 0, end: text.length } }, virtualPath: 'sample.py',
      virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'double', kind: 'function' } }],
    initializationOptions, captureDiagnostics: true, uriScheme: 'file',
    collectTypes: server !== 'ruff',
    parseSignature: parsePythonSignature,
    sessionPoolingEnabled: false, vfsColdStartCache: false, timeoutMs: 5000, retries: 0, strict: false });
  result.collectorChunks = Object.keys(collected.byChunkUid).length;
  result.collectorChecks = collected.checks.map(({ name, status }) => ({ name, status }));
  result.collectorDiagnosticsCount = collected.diagnosticsCount;
  if (server !== 'ruff') {
    result.collectorReturnType = collected.byChunkUid['ck64:v1:test:python:acceptance']?.payload?.returnType;
    assert.equal(result.collectorReturnType, 'int');
  }
  if (server === 'pyright') {
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname="poc_pyright_fixture"\nversion="0.0.0"\n');
    fs.writeFileSync(path.join(root, 'pyrightconfig.json'), JSON.stringify({ typeCheckingMode: 'basic', useLibraryCodeForTypes: false }));
    const provider = createPyrightProvider();
    const accepted = await provider.run({ repoRoot: root, buildRoot: root, strict: false,
      toolingConfig: { pyright: { cmd: binary, args, timeoutMs: 5000, retries: 0 },
        lsp: { sessionPoolingEnabled: false } }, cache: { enabled: false, dir: path.join(home, 'poc-cache') } }, {
      documents: [{ virtualPath: 'sample.py', text, languageId: 'python', effectiveExt: '.py' }],
      targets: [{ chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:python:dedicated', chunkId: 'python-dedicated',
        file: 'sample.py', range: { start: 0, end: text.length } }, virtualPath: 'sample.py',
        virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'double', kind: 'function' } }], kinds: ['types', 'diagnostics'] });
    assert.ok(Object.keys(accepted.byChunkUid).length > 0, 'actual dedicated Pyright adapter enriches its fixture');
    assert.equal(accepted.byChunkUid['ck64:v1:test:python:dedicated']?.payload?.returnType, 'int');
    result.dedicatedAdapter = true;
    result.dedicatedAdapterChunks = Object.keys(accepted.byChunkUid).length;
    result.dedicatedAdapterDiagnosticsCount = accepted.diagnostics?.diagnosticsCount;
  } else {
    const provider = createConfiguredLspProvider(normalizeServerConfig({ id: server, languages: ['python'],
      cmd: binary, args, initializationOptions, requireWorkspaceModel: false }, 0));
    const accepted = await provider.run({ repoRoot: root, buildRoot: root, strict: false,
      toolingConfig: { lsp: { enabled: true, timeoutMs: 5000, retries: 0 } } }, {
      documents: [{ virtualPath: 'sample.py', text, languageId: 'python', effectiveExt: '.py' }],
      targets: [{ chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:python:configured', chunkId: 'python-configured',
        file: 'sample.py', range: { start: 0, end: text.length } }, virtualPath: 'sample.py',
        virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'double', kind: 'function' } }],
      kinds: server === 'ruff' ? ['diagnostics'] : ['types', 'diagnostics'] });
    assert.equal(accepted.diagnostics.diagnosticsCount, server === 'ruff' ? 1 : 2);
    assert.equal(accepted.diagnostics.fidelity.contributes.typeEnrichment, server !== 'ruff');
    if (server === 'ruff') assert.deepEqual(accepted.byChunkUid, {});
    else assert.equal(accepted.byChunkUid['ck64:v1:test:python:configured']?.payload?.returnType, 'int');
    result.configuredProvider = true;
  }
  if (server !== 'ruff') assert.ok(result.collectorChunks > 0);
  else {
    assert.equal(result.collectorChunks, 0);
    assert.equal(result.collectorDiagnosticsCount, 1);
    assert.ok(!collected.runtime.capabilities.documentSymbol);
    assert.ok(Object.values(collected.runtime.capabilityGate.requested).every((value) => value === false));
    result.diagnosticsOnlyAccepted = true;
  }
  console.log(JSON.stringify(result));
} finally {
  await client.shutdownAndExit();
  client.killSync();
  await __testLspSessionPool.reset();
  clearTimeout(deadline);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, priorEnv);
  fs.rmSync(container, { recursive: true, force: true });
}
