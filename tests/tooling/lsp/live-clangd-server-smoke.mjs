// Opt-in C/C++ acceptance. Install and checksum-verify official clangd separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLspClient, pathToFileUri } from '../../../src/integrations/tooling/lsp/client.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseClikeSignature } from '../../../src/index/tooling/signature-parse/clike.js';
import { createClangdProvider } from '../../../src/index/tooling/clangd-provider.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';

const [language, suppliedBinary] = process.argv.slice(2);
assert.ok(suppliedBinary && path.isAbsolute(suppliedBinary), 'Supply an absolute checksum-verified clangd binary');
assert.ok(['c', 'cpp'].includes(language));
const binary = fs.realpathSync(suppliedBinary);
const container = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-clangd-'));
const root = path.join(container, 'workspace');
const home = path.join(container, 'home');
fs.mkdirSync(root);
fs.mkdirSync(home);
const file = path.join(root, language === 'c' ? 'sample.c' : 'sample.cpp');
const text = 'int double_value(int x) { return x * 2; }\nint example(void) { return double_value(2); }\n';
fs.writeFileSync(file, text);
fs.writeFileSync(path.join(home, 'compile_commands.json'), JSON.stringify([{ directory: root, file,
  arguments: ['clang', '-x', language === 'c' ? 'c' : 'c++', language === 'c' ? '-std=c17' : '-std=c++20', '-fsyntax-only', file] }]));
const args = ['--background-index=false', '--clang-tidy=false', '--enable-config=false', '--query-driver=', '-j=1',
  '--log=error', '--compile-commands-dir=' + home];
const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: home, XDG_CACHE_HOME: path.join(home, 'cache'),
  XDG_CONFIG_HOME: path.join(home, 'config'), PAIROFCLEATS_EMBEDDINGS: 'off', PAIROFCLEATS_THREADS: '1',
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
const client = createLspClient({ cmd: binary, args, cwd: root, env, providerId: 'clangd-acceptance' });
const priorEnv = { ...process.env };
const deadline = setTimeout(() => { client.killSync(); process.exitCode = 1; }, 30000);
try {
  const version = execFileSync(binary, ['--version'], { cwd: home, env, timeout: 5000, encoding: 'utf8' }).trim();
  await client.initialize({ rootUri: pathToFileUri(root),
    workspaceFolders: [{ uri: pathToFileUri(root), name: 'tiny-fixture' }],
    capabilities: { textDocument: { hover: { contentFormat: ['plaintext', 'markdown'] } } }, timeoutMs: 5000 });
  const uri = pathToFileUri(file);
  client.notify('textDocument/didOpen', { textDocument: { uri, languageId: language, version: 1, text } });
  const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs: 5000 });
  assert.ok(symbols.some((symbol) => symbol.name === 'double_value'));
  const position = { line: 1, character: text.split('\n')[1].indexOf('double_value') + 2 };
  const hover = await client.request('textDocument/hover', { textDocument: { uri }, position }, { timeoutMs: 5000 });
  assert.match(JSON.stringify(hover), /double_value/);
  const definition = await client.request('textDocument/definition', { textDocument: { uri }, position }, { timeoutMs: 5000 });
  const locations = Array.isArray(definition) ? definition : definition ? [definition] : [];
  assert.ok(locations.some((location) => (location.uri || location.targetUri) === uri));
  await client.shutdownAndExit();
  client.killSync();
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  const virtualPath = path.basename(file);
  const uid = `ck64:v1:test:clangd:${language}`;
  const collected = await collectLspTypes({ rootDir: root, cmd: binary, args, providerId: 'clangd',
    documents: [{ virtualPath, text, languageId: language, effectiveExt: path.extname(file) }],
    targets: [{ chunkRef: { docId: 0, chunkUid: uid, chunkId: 'clangd-fixture', file: virtualPath,
      range: { start: 0, end: text.length } }, virtualPath, virtualRange: { start: 0, end: text.length },
      symbolHint: { name: 'double_value', kind: 'function' } }],
    parseSignature: (detail, _language, symbolName) => parseClikeSignature(detail, symbolName),
    uriScheme: 'file', sessionPoolingEnabled: false, vfsColdStartCache: false, timeoutMs: 5000, retries: 0, strict: false });
  assert.equal(collected.byChunkUid[uid]?.payload?.returnType, 'int');
  const dedicated = await createClangdProvider().run({ repoRoot: root, buildRoot: root, strict: false,
    toolingConfig: { clangd: { cmd: binary, args, compileCommandsDir: home, autoInferIncludeRoots: false,
      timeoutMs: 5000, retries: 0, documentSymbolConcurrency: 1, hoverConcurrency: 1 } },
    cache: { enabled: false, dir: path.join(home, 'poc-cache') } }, {
    documents: [{ virtualPath, text, languageId: language, effectiveExt: path.extname(file) }],
    targets: [{ chunkRef: { docId: 0, chunkUid: uid, chunkId: 'clangd-fixture', file: virtualPath,
      range: { start: 0, end: text.length } }, virtualPath, virtualRange: { start: 0, end: text.length },
      symbolHint: { name: 'double_value', kind: 'function' } }], kinds: ['types'] });
  assert.equal(dedicated.byChunkUid[uid]?.payload?.returnType, 'int');
  const result = { server: 'clangd', version, language,
    binarySha256: createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
    actualPoCClient: true, actualPoCCollector: true, actualDedicatedAdapter: true, symbols: true, hover: true, definition: true,
    collectedReturnType: 'int', driverQueries: false, projectConfiguration: false,
    backgroundIndex: false, clangTidy: false, fixtureExecution: false, fullIndexing: false, modelWork: false };
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
