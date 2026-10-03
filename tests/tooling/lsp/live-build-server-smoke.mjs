// Opt-in, one-server acceptance. Install and checksum-verify official tools first.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { createLspClient, pathToFileUri } from '../../../src/integrations/tooling/lsp/client.js';
import { createLspConfigurationHandler } from '../../../src/integrations/tooling/lsp/configuration.js';

const [server, suppliedBinary, suppliedSdk] = process.argv.slice(2);
assert.ok(['rust-analyzer', 'zls'].includes(server));
assert.ok(suppliedBinary && path.isAbsolute(suppliedBinary), 'Supply an absolute verified server binary');
assert.ok(suppliedSdk && path.isAbsolute(suppliedSdk), 'Supply its absolute compatible SDK root');
const binary = fs.realpathSync(suppliedBinary);
const sdk = fs.realpathSync(suppliedSdk);
const rust = server === 'rust-analyzer';
const container = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-build-lsp-'));
const root = path.join(container, 'workspace');
const home = path.join(container, 'home');
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.mkdirSync(home);
const env = { PATH: (rust ? path.join(sdk, 'bin') : sdk) + path.delimiter + '/usr/bin:/bin',
  HOME: home, TMPDIR: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'),
  PAIROFCLEATS_EMBEDDINGS: 'off', PAIROFCLEATS_THREADS: '1',
  HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' };
const priorEnv = { ...process.env };
const settings = rust ? {
  cargo: { buildScripts: { enable: false }, allTargets: false }, procMacro: { enable: false },
  checkOnSave: false, numThreads: 1, files: { excludeDirs: ['target'] }
} : {
  zig_exe_path: path.join(sdk, 'zig'), zig_lib_path: path.join(sdk, 'lib'),
  enable_build_on_save: false, prefer_ast_check_as_child_process: false,
  global_cache_path: path.join(home, 'zig-cache')
};
if (rust) Object.assign(env, { CARGO_HOME: path.join(home, 'cargo'), CARGO_NET_OFFLINE: 'true',
  CARGO_BUILD_JOBS: '1', RAYON_NUM_THREADS: '1', RUSTC: path.join(sdk, 'bin/rustc'), CARGO: path.join(sdk, 'bin/cargo') });
else Object.assign(env, { ZIG_GLOBAL_CACHE_DIR: path.join(home, 'zig-global'), ZIG_LOCAL_CACHE_DIR: path.join(home, 'zig-local') });
const args = [];
if (!rust) {
  const config = path.join(home, 'owner-config.json');
  fs.writeFileSync(config, JSON.stringify(settings));
  args.push('--config-path', config);
}
const initializationOptions = rust ? settings : undefined;
const onRequest = createLspConfigurationHandler({ settings: { [server]: settings } });
const text = rust
  ? 'pub fn double(x: i32) -> i32 { x * 2 }\npub fn example() -> i32 { double(2) }\n'
  : 'pub fn double(x: i32) i32 { return x * 2; }\npub fn example() i32 { return double(2); }\n';
const virtualPath = rust ? 'src/lib.rs' : 'src/sample.zig';
const file = path.join(root, virtualPath);
fs.writeFileSync(file, text);
if (rust) fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname="poc_rust_fixture"\nversion="0.0.0"\nedition="2021"\n');
// No build.rs, proc macros, build.zig, dependency or workspace-selected config.
const inputs = { documents: [{ virtualPath, text, languageId: rust ? 'rust' : 'zig', effectiveExt: path.extname(file) }],
  targets: [{ chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:build:lsp', chunkId: 'build-lsp', file: virtualPath,
    range: { start: 0, end: text.length } }, virtualPath, virtualRange: { start: 0, end: text.length },
    symbolHint: { name: 'double', kind: 'function' } }] };
const client = createLspClient({ cmd: binary, args, cwd: root, env,
  providerId: `${server}-sdk-smoke`, onRequest });
const deadline = setTimeout(() => { client.killSync(); process.exitCode = 1; console.error('SDK acceptance exceeded 30 seconds'); }, 30000);
try {
  // The common collector normally receives launch environment authority. The
  // opt-in fixture supplies only this explicit generated environment, no secrets.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  const denied = await collectLspTypes({ rootDir: root, cmd: binary, args, providerId: server, ...inputs });
  assert.equal(denied.runtime.executionAuthority.state, 'blocked');
  process.env.PAIROFCLEATS_TRUSTED_REPOS = JSON.stringify([fs.realpathSync(root)]);
  const version = execFileSync(binary, ['--version'], { cwd: root, env, timeout: 5000, encoding: 'utf8' }).trim();
  const sdkVersion = execFileSync(rust ? env.RUSTC : settings.zig_exe_path, rust ? ['--version'] : ['version'],
    { cwd: root, env, timeout: 5000, encoding: 'utf8' }).trim();
  await client.initialize({ rootUri: pathToFileUri(root), workspaceFolders: [{ uri: pathToFileUri(root), name: 'tiny-fixture' }],
    capabilities: { workspace: { configuration: true }, textDocument: { hover: { contentFormat: ['plaintext'] } } },
    initializationOptions, timeoutMs: 5000 });
  const uri = pathToFileUri(file);
  client.notify('textDocument/didOpen', { textDocument: { uri, languageId: rust ? 'rust' : 'zig', version: 1, text } });
  const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs: 5000 });
  assert.ok(symbols.some((symbol) => symbol.name === 'double'));
  const position = { line: 1, character: text.split('\n')[1].indexOf('double') + 2 };
  let hover, definition;
  const ready = Date.now() + 5000;
  do {
    hover = await client.request('textDocument/hover', { textDocument: { uri }, position }, { timeoutMs: 1500 });
    definition = await client.request('textDocument/definition', { textDocument: { uri }, position }, { timeoutMs: 1500 });
    if (hover && (Array.isArray(definition) ? definition.length : definition?.uri || definition?.targetUri)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < ready);
  assert.match(JSON.stringify(hover), /double/);
  const locations = Array.isArray(definition) ? definition : definition ? [definition] : [];
  assert.ok(locations.some((location) => (location.uri || location.targetUri) === uri), 'definition must target the same fixture file');
  await client.shutdownAndExit();
  client.killSync();
  const collected = await collectLspTypes({ rootDir: root, workspaceRootDir: root, cmd: binary, args,
    providerId: server, ...inputs, uriScheme: 'file', initializationOptions,
    sessionPoolingEnabled: false, vfsColdStartCache: false, timeoutMs: 5000, retries: 0, strict: false });
  assert.ok(Object.keys(collected.byChunkUid).length > 0);
  console.log(JSON.stringify({ server, version, sdkVersion,
    binarySha256: createHash('sha256').update(fs.readFileSync(binary)).digest('hex'),
    actualPoCClient: true, actualPoCCollector: true, untrustedDenied: true, exactFixtureGrant: true,
    initialized: true, documentSymbols: true, hover: true, definition: true,
    fixtureBuildScripts: 0, fixtureProcMacros: 0, dependencyDownloads: 0,
    fullProviderPipeline: false, fullIndexing: false, modelWork: false }));
} finally {
  await client.shutdownAndExit();
  client.killSync();
  clearTimeout(deadline);
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, priorEnv);
  fs.rmSync(container, { recursive: true, force: true });
}
