// Opt-in native/SDK fixtures. Install and verify official tools separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLspClient, pathToFileUri } from '../../../src/integrations/tooling/lsp/client.js';
import { createLspConfigurationHandler } from '../../../src/integrations/tooling/lsp/configuration.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';

const [server, suppliedBinary, suppliedGoRoot] = process.argv.slice(2);
assert.ok(['lua-language-server', 'gopls', 'sqls'].includes(server));
assert.ok(suppliedBinary && path.isAbsolute(suppliedBinary), 'Supply an absolute verified binary path');
const binary = fs.realpathSync(suppliedBinary);
assert.ok(server !== 'gopls' || suppliedGoRoot && path.isAbsolute(suppliedGoRoot), 'gopls requires the absolute Go SDK root');
const goRoot = server === 'gopls' ? fs.realpathSync(suppliedGoRoot) : null;
const binarySha256 = createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-sdk-lsp-'));
const home = path.join(root, '.server-home');
fs.mkdirSync(home);
const env = {
  PATH: goRoot ? path.join(goRoot, 'bin') + path.delimiter + '/usr/bin:/bin' : '/usr/bin:/bin',
  HOME: home, TMPDIR: home, XDG_CONFIG_HOME: path.join(home, 'config'),
  GOMAXPROCS: '1', GOMEMLIMIT: '256MiB', GOGC: '30', GOENV: 'off', GOTOOLCHAIN: 'local',
  GOPROXY: 'off', CGO_ENABLED: '0', GOFLAGS: '-p=1',
  GOPATH: path.join(home, 'go'), GOCACHE: path.join(home, 'go-cache'),
  PAIROFCLEATS_EMBEDDINGS: 'off', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'
};
if (goRoot) env.GOROOT = goRoot;
const luaSettings = {
  runtime: { version: 'Lua 5.4', plugin: [] },
  workspace: { checkThirdParty: false, library: [], maxPreload: 16, preloadFileSize: 64 },
  hint: { enable: false }, telemetry: { enable: false }
};
const profile = server === 'lua-language-server' ? {
  ext: '.lua', symbol: 'double', position: { line: 3, character: 17 },
  text: '---@param x number\n---@return number\nlocal function double(x) return x * 2 end\nlocal value = double(2)\nreturn value\n',
  settings: { Lua: luaSettings }
} : server === 'gopls' ? {
  ext: '.go', symbol: 'Double', position: { line: 3, character: 16 },
  text: 'package road\n\nfunc Double(x int) int { return x * 2 }\nvar Value = Double(2)\n',
  initialize: { staticcheck: false, expandWorkspaceToModule: false, diagnosticsDelay: '50ms',
    vulncheck: 'Off', directoryFilters: ['-**/.git', '-**/node_modules'] }
} : { ext: '.sql', text: 'select 1;\n' };
const configurationHandler = createLspConfigurationHandler({ settings: profile.settings });
const args = server === 'sqls' ? ['-config', path.join(home, 'owner-config.yml')]
  : resolveLspServerPresetByKey(server).args;
if (server === 'lua-language-server') {
  const config = path.join(home, 'owner-config.json');
  fs.writeFileSync(config, JSON.stringify(profile.settings));
  args.push(`--configpath=${config}`, `--logpath=${path.join(home, 'logs')}`, `--metapath=${path.join(home, 'meta')}`);
} else if (server === 'sqls') {
  fs.writeFileSync(args[1], 'connections: []\n');
} else {
  fs.writeFileSync(path.join(root, 'go.mod'), 'module poc.test/road\n\ngo 1.26.0\n');
}
const file = path.join(root, `sample${profile.ext}`);
const uri = pathToFileUri(file);
fs.writeFileSync(file, profile.text);
const client = createLspClient({
  cmd: binary, args, cwd: root, env, providerId: `${server}-sdk-smoke`,
  onRequest: (message) => configurationHandler ? configurationHandler(message) : null
});
const deadline = setTimeout(() => {
  client.killSync();
  process.exitCode = 1;
  console.error('SDK LSP acceptance exceeded 30 seconds');
}, 30000);
try {
  if (goRoot) {
    execFileSync(path.join(goRoot, 'bin/go'), ['telemetry', 'off'], { cwd: root, env, timeout: 5000 });
  }
  const versionOutput = execFileSync(binary, [server === 'gopls' ? 'version' : '--version'], {
    cwd: root, env, encoding: 'utf8', timeout: 5000, maxBuffer: 16384
  }).trim();
  const initialized = await client.initialize({
    rootUri: pathToFileUri(root), workspaceFolders: [{ uri: pathToFileUri(root), name: 'tiny-fixture' }],
    capabilities: {
      ...(configurationHandler ? { workspace: { configuration: true } } : {}),
      textDocument: { hover: { contentFormat: ['plaintext', 'markdown'] } }
    }, initializationOptions: profile.initialize, timeoutMs: 5000
  });
  const result = { server, versionOutput, binarySha256, actualPoCClient: true, initialized: true };
  client.notify('textDocument/didOpen', {
    textDocument: { uri, languageId: server === 'lua-language-server' ? 'lua' : server === 'gopls' ? 'go' : 'sql', version: 1, text: profile.text }
  });
  if (server === 'sqls') {
    assert.equal(initialized.capabilities.documentSymbolProvider, undefined);
    const edits = await client.request('textDocument/formatting', {
      textDocument: { uri }, options: { tabSize: 2, insertSpaces: true }
    }, { timeoutMs: 5000 });
    assert.ok(Array.isArray(edits) && edits.length > 0);
    assert.match(edits.map((edit) => edit.newText).join(''), /SELECT\s+1/);
    const completion = await client.request('textDocument/completion', {
      textDocument: { uri }, position: { line: 0, character: 3 }
    }, { timeoutMs: 5000 });
    const items = Array.isArray(completion) ? completion : completion?.items;
    assert.ok(Array.isArray(items) && items.some((item) => /select/i.test(item.label)));
    Object.assign(result, { formatting: true, keywordCompletion: true, documentSymbols: false, databaseConnections: 0 });
  } else {
    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs: 5000 });
    assert.ok(Array.isArray(symbols) && symbols.some((symbol) => symbol.name === profile.symbol));
    const hover = await client.request('textDocument/hover', {
      textDocument: { uri }, position: profile.position
    }, { timeoutMs: 5000 });
    assert.match(JSON.stringify(hover), /double|Double|number/);
    const definition = await client.request('textDocument/definition', {
      textDocument: { uri }, position: profile.position
    }, { timeoutMs: 5000 });
    assert.ok(Array.isArray(definition) && definition.length > 0);
    Object.assign(result, { documentSymbols: true, hover: true, definition: true });
  }
  Object.assign(result, { fixtureExecution: false, fullProviderPipeline: false, fullIndexing: false, modelWork: false });
  console.log(JSON.stringify(result));
} finally {
  await client.shutdownAndExit();
  client.killSync();
  clearTimeout(deadline);
  fs.rmSync(root, { recursive: true, force: true });
}
