// Opt-in, one-server acceptance. This file is not an automatic test or installer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLspClient, languageIdForFileExt, pathToFileUri } from '../../../src/integrations/tooling/lsp/client.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import { createLspConfigurationHandler } from '../../../src/integrations/tooling/lsp/configuration.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

const [server, suppliedModules] = process.argv.slice(2);
const supported = ['yaml-language-server', 'typescript-language-server', 'bash-language-server'];
assert.ok(supported.includes(server), `Choose one server: ${supported.join(', ')}`);
const collectorMode = process.argv[4] === '--collector';
assert.ok(!collectorMode || server === 'yaml-language-server', 'Collector mode currently accepts the YAML fixture');
assert.ok(suppliedModules && path.isAbsolute(suppliedModules), 'Supply an absolute installed node_modules path');
const nodeModules = fs.realpathSync(suppliedModules);
const packageRoot = fs.realpathSync(path.join(nodeModules, server));
assert.ok(packageRoot.startsWith(nodeModules + path.sep), 'Server package must belong to the supplied installation');
const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'))).version;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-live-lsp-'));
const home = path.join(root, '.server-home');
fs.mkdirSync(home);
const yamlPreset = resolveLspServerPresetByKey('yaml');
const yamlSettings = {
  yaml: { ...yamlPreset.initializationOptions.settings.yaml, validate: true, schemas: {} }
};
const bashSettings = {
  backgroundAnalysisMaxFiles: 0, includeAllWorkspaceSymbols: false,
  shellcheckPath: '', shellcheckExternalSources: false, explainshellEndpoint: '',
  shfmt: { path: '', ignoreEditorconfig: true }, logLevel: 'error'
};
const profile = server === 'yaml-language-server' ? {
  entry: 'bin/yaml-language-server', args: yamlPreset.args, ext: '.yaml', symbol: 'road',
  text: 'road: 1\nname: café\n', settings: yamlSettings,
  initialize: { ...yamlPreset.initializationOptions, settings: yamlSettings }
} : server === 'bash-language-server' ? {
  entry: 'out/cli.js', args: ['start'], ext: '.sh', symbol: 'double_value',
  text: '#!/bin/bash\n# Double fixture\ndouble_value() { printf "%s\\n" "$1"; }\ndouble_value 2\n',
  settings: bashSettings, initialize: bashSettings, position: { line: 3, character: 4 }
} : {
  entry: 'lib/cli.mjs', args: ['--stdio', '--log-level', '1'], ext: '.ts', symbol: 'double',
  text: 'export function double(x: number): number { return x * 2; }\nexport const value = double(2);\n',
  settings: {}, initialize: {
    tsserver: { path: path.join(nodeModules, 'typescript/lib/tsserver.js') },
    maxTsServerMemory: 256, disableAutomaticTypingAcquisition: true,
    preferences: { includePackageJsonAutoImports: 'off' }
  }, position: { line: 1, character: 24 }
};
const file = path.join(root, `sample${profile.ext}`);
const uri = pathToFileUri(file);
fs.writeFileSync(file, profile.text);
if (server === 'typescript-language-server') {
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, types: [] }, files: ['sample.ts']
  }));
}
let pendingDiagnostic = null;
let diagnosticTimer = null;
const notifications = [];
const configurationHandler = createLspConfigurationHandler(profile.initialize);
const safeEnv = {
  PATH: process.env.PATH, HOME: home, TMPDIR: home,
  NODE_OPTIONS: '--max-old-space-size=512', UV_THREADPOOL_SIZE: '1',
  PAIROFCLEATS_THREADS: '1', PAIROFCLEATS_EMBEDDINGS: 'off', PAIROFCLEATS_WORKER_POOL: 'off',
  BASH_IDE_LOG_LEVEL: 'error', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1'
};
const client = createLspClient({
  cmd: process.execPath, args: [path.join(packageRoot, profile.entry), ...profile.args], cwd: root,
  env: safeEnv,
  providerId: `${server}-smoke`,
  onRequest: async (message) => {
    return configurationHandler ? configurationHandler(message) : null;
  },
  onNotification: (message) => {
    notifications.push(message);
    if (message.method === 'textDocument/publishDiagnostics'
      && message.params?.uri === uri && message.params?.diagnostics?.length && pendingDiagnostic) {
      pendingDiagnostic(message.params.diagnostics);
      pendingDiagnostic = null;
    }
  }
});
const abortController = new AbortController();
const deadline = setTimeout(() => {
  abortController.abort();
  client.killSync();
  console.error('Live LSP acceptance exceeded 30 seconds');
  process.exitCode = 1;
}, 30000);
try {
  if (collectorMode) {
    const previousEnv = { ...process.env };
    try {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, safeEnv);
      const text = 'road: 1\nroad: 2\n';
      const virtualPath = 'sample.yaml';
      const chunkUid = 'ck64:v1:tiny:yaml:diagnostics';
      const result = await collectLspTypes({
        rootDir: root, vfsRoot: root, documents: [{ virtualPath, text, effectiveExt: '.yaml' }],
        targets: [{
          chunkRef: { docId: 0, chunkUid, chunkId: 'tiny-yaml', file: virtualPath, segmentUid: null,
            segmentId: null, range: { start: 0, end: text.length } },
          virtualPath, virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'road', kind: 'property' }
        }],
        cmd: process.execPath, args: [path.join(packageRoot, profile.entry), ...profile.args],
        initializationOptions: yamlPreset.initializationOptions, providerId: yamlPreset.id,
        captureDiagnostics: true, sessionPoolingEnabled: false, vfsColdStartCache: false,
        timeoutMs: 5000, retries: 0, documentSymbolConcurrency: 1, hoverConcurrency: 1,
        hoverEnabled: false, signatureHelpEnabled: false, definitionEnabled: false,
        typeDefinitionEnabled: false, referencesEnabled: false, semanticTokensEnabled: false,
        inlayHintsEnabled: false, abortSignal: abortController.signal
      });
      assert.ok(result.diagnosticsCount > 0);
      assert.ok(result.diagnosticsByChunkUid[chunkUid].some((item) => /duplicate|unique/i.test(item.message)));
      console.log(JSON.stringify({ server, installedVersion: version, actualPoCCollector: true,
        chunkDiagnostics: true, diagnosticsDrain: result.runtime.diagnosticsDrain,
        fullProviderPipeline: false, fullIndexing: false, modelWork: false }));
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previousEnv);
    }
  } else {
    await client.initialize({
      rootUri: pathToFileUri(root), workspaceFolders: [{ uri: pathToFileUri(root), name: 'tiny-fixture' }],
      capabilities: {
        ...(configurationHandler ? { workspace: { configuration: true } } : {}),
        textDocument: { hover: { contentFormat: ['plaintext', 'markdown'] }, publishDiagnostics: { versionSupport: true } }
      },
      initializationOptions: profile.initialize, timeoutMs: 5000
    });
    client.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: languageIdForFileExt(profile.ext), version: 1, text: profile.text }
    });
    const symbols = await client.request('textDocument/documentSymbol', { textDocument: { uri } }, { timeoutMs: 5000 });
    assert.ok(Array.isArray(symbols) && symbols.some((symbol) => symbol.name === profile.symbol));
    const result = { server, installedVersion: version, actualPoCClient: true, initialized: true, documentSymbols: true };
    if (server === 'yaml-language-server') {
      const received = new Promise((resolve, reject) => {
        pendingDiagnostic = resolve;
        diagnosticTimer = setTimeout(() => reject(new Error('YAML diagnostics timed out')), 5000);
      });
      client.notify('textDocument/didChange', {
        textDocument: { uri, version: 2 }, contentChanges: [{ text: 'road: 1\nroad: 2\n' }]
      });
      const diagnostics = await received;
      assert.ok(diagnostics.some((item) => /duplicate|unique/i.test(item.message)));
      result.duplicateKeyDiagnostics = true;
    } else {
      const hover = await client.request('textDocument/hover', {
        textDocument: { uri }, position: profile.position
      }, { timeoutMs: 5000 });
      assert.match(JSON.stringify(hover), server === 'bash-language-server' ? /Double fixture|double_value/ : /double.*number/);
      const definition = await client.request('textDocument/definition', {
        textDocument: { uri }, position: profile.position
      }, { timeoutMs: 5000 });
      assert.ok(Array.isArray(definition) && definition.length > 0);
      result.hover = true;
      result.definition = true;
    }
    if (server === 'typescript-language-server') {
      result.compilerVersion = JSON.parse(fs.readFileSync(path.join(nodeModules, 'typescript/package.json'))).version;
      const usedVersion = notifications.find((message) => message.method === '$/typescriptVersion')?.params;
      assert.equal(usedVersion?.version, result.compilerVersion);
      assert.equal(usedVersion?.source, 'user-setting');
    }
    result.fullProviderPipeline = false;
    result.fullIndexing = false;
    result.modelWork = false;
    console.log(JSON.stringify(result));
  }
} finally {
  clearTimeout(diagnosticTimer);
  await client.shutdownAndExit();
  client.killSync();
  clearTimeout(deadline);
  fs.rmSync(root, { recursive: true, force: true });
}
