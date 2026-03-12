#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const extensionPath = path.resolve('extensions/vscode/extension.js');

function createFakeConfiguration(values) {
  return {
    get(key) {
      return values[key];
    }
  };
}

function loadExtensionWithMocks({ fakeVscode, fakeChildProcess }) {
  const originalLoad = Module._load;
  delete require.cache[extensionPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'vscode') return fakeVscode;
    if (request === 'node:child_process') return fakeChildProcess;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(extensionPath);
  } finally {
    Module._load = originalLoad;
  }
}

function createFakeSpawn(spawnCalls, queuedResults) {
  return {
    spawn(command, args, options) {
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      const result = queuedResults.shift();
      setImmediate(() => {
        if (!result) {
          child.emit('close', 0);
          return;
        }
        if (result.stdout) {
          child.stdout.emit('data', Buffer.from(result.stdout));
        }
        if (result.stderr) {
          child.stderr.emit('data', Buffer.from(result.stderr));
        }
        if (result.error) {
          child.emit('error', result.error);
          return;
        }
        child.emit('close', result.code ?? 0);
      });
      return child;
    }
  };
}

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-workflow-'));
const srcDir = path.join(repoRoot, 'src');
const testsDir = path.join(repoRoot, 'tests');
const rulesDir = path.join(repoRoot, 'rules');
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(testsDir, { recursive: true });
fs.mkdirSync(rulesDir, { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(srcDir, 'app.ts'), 'export const value = 1;\n');
fs.writeFileSync(path.join(testsDir, 'app.test.ts'), 'test("ok", () => {});\n');
fs.writeFileSync(path.join(rulesDir, 'architecture.rules.json'), '{"version":1,"rules":[]}\n');
const workspacePath = path.join(repoRoot, '.pairofcleats-workspace.jsonc');
fs.writeFileSync(workspacePath, '{"name":"Workspace","repos":[]}\n');

const configValues = {
  cliPath: '',
  cliArgs: ['--trace'],
  searchMode: 'code',
  searchBackend: '',
  searchAnn: true,
  maxResults: 25,
  searchContextLines: 0,
  searchFile: '',
  searchPath: '',
  searchLang: '',
  searchExt: '',
  searchType: '',
  searchCaseSensitive: false,
  extraSearchArgs: [],
  env: {}
};

const outputEvents = [];
const errorMessages = [];
const infoMessages = [];
const openExternalCalls = [];
const registeredCommands = [];
const spawnCalls = [];
const queuedResults = [];
const inputQueue = [];
const quickPickQueue = [];
const fakeVscode = {
  workspace: {
    workspaceFolders: [{ name: 'repo', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } }],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => folder.uri.fsPath === uri?.fsPath) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    },
    async openTextDocument(uri) {
      return { uri };
    }
  },
  window: {
    activeTextEditor: { document: { uri: { scheme: 'file', fsPath: path.join(srcDir, 'app.ts') } } },
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return { dispose() {} };
        }
      };
      return task({}, token);
    },
    async showInputBox() {
      return inputQueue.shift();
    },
    async showQuickPick(items) {
      const next = quickPickQueue.shift();
      if (typeof next === 'function') return next(items);
      return next ?? null;
    },
    showErrorMessage(message) {
      errorMessages.push(message);
    },
    showInformationMessage(message) {
      infoMessages.push(message);
    },
    async showTextDocument(document) {
      return {
        document,
        selection: null,
        revealRange() {}
      };
    },
    createOutputChannel(name) {
      return {
        name,
        appendLine(line) {
          outputEvents.push({ kind: 'append', line });
        },
        show(preserveFocus) {
          outputEvents.push({ kind: 'show', preserveFocus });
        }
      };
    }
  },
  commands: {
    registerCommand(id, handler) {
      registeredCommands.push(id);
      return { id, handler, dispose() {} };
    },
    async executeCommand() {}
  },
  env: {
    async openExternal(uri) {
      openExternalCalls.push(uri);
      return true;
    }
  },
  Uri: {
    file(fsPath) {
      return { scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') };
    }
  },
  Position: class Position {
    constructor(line, character) {
      this.line = line;
      this.character = character;
    }
  },
  Range: class Range {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  Selection: class Selection {
    constructor(start, end) {
      this.start = start;
      this.end = end;
    }
  },
  TextEditorRevealType: {
    InCenter: 1
  },
  ProgressLocation: {
    Notification: 1
  }
};

const extension = loadExtensionWithMocks({
  fakeVscode,
  fakeChildProcess: createFakeSpawn(spawnCalls, queuedResults)
});

extension.activate({ subscriptions: [] });
for (const commandId of [
  'pairofcleats.codeMap',
  'pairofcleats.architectureCheck',
  'pairofcleats.impact',
  'pairofcleats.suggestTests',
  'pairofcleats.workspaceManifest',
  'pairofcleats.workspaceStatus',
  'pairofcleats.workspaceBuild',
  'pairofcleats.workspaceCatalog'
]) {
  assert.ok(registeredCommands.includes(commandId), `missing registered command ${commandId}`);
}

const codeMapSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.codeMap');
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    format: 'html-iso',
    outPath: path.join(repoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html'),
    summary: { counts: { files: 4, members: 10, edges: 12 } },
    warnings: []
  })
});
await extension._test.runOperatorCommand(codeMapSpec);
assert.equal(infoMessages.pop(), 'PairOfCleats: Code Map completed.');
assert.deepEqual(
  spawnCalls[0].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'report',
    'map',
    '--json',
    '--repo',
    repoRoot,
    '--format',
    'html-iso',
    '--out',
    path.join(repoRoot, '.pairofcleats', 'maps', 'vscode-map.iso.html')
  ]
);
assert.equal(openExternalCalls.length, 1, 'expected code map to open generated artifact');

const architectureSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.architectureCheck');
inputQueue.push(path.join('rules', 'architecture.rules.json'));
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    rules: [{ id: 'forbidden-import' }],
    violations: [],
    warnings: []
  })
});
await extension._test.runOperatorCommand(architectureSpec);
assert.equal(infoMessages.pop(), 'PairOfCleats: Architecture Check completed.');
assert.deepEqual(
  spawnCalls[1].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'architecture-check',
    '--json',
    '--repo',
    repoRoot,
    '--rules',
    path.join(repoRoot, 'rules', 'architecture.rules.json')
  ]
);

const impactSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.impact');
inputQueue.push('');
inputQueue.push('src/app.ts');
inputQueue.push('2');
quickPickQueue.push((items) => items.find((item) => item.value === 'downstream'));
quickPickQueue.push(null);
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    direction: 'downstream',
    depth: 2,
    impacted: [{ ref: { type: 'file', path: 'src/app.ts' }, witnessPath: { nodes: [{ path: 'src/app.ts' }] } }],
    warnings: [],
    truncation: []
  })
});
await extension._test.runOperatorCommand(impactSpec);
assert.equal(infoMessages.pop(), 'PairOfCleats: Impact Analysis completed.');
assert.deepEqual(
  spawnCalls[2].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'impact',
    '--json',
    '--repo',
    repoRoot,
    '--direction',
    'downstream',
    '--depth',
    '2',
    '--changed',
    'src/app.ts'
  ]
);

const suggestTestsSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.suggestTests');
inputQueue.push('src/app.ts');
inputQueue.push('7');
quickPickQueue.push(null);
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    suggestions: [{ testPath: 'tests/app.test.ts', score: 0.9 }],
    warnings: []
  })
});
await extension._test.runOperatorCommand(suggestTestsSpec);
assert.equal(infoMessages.pop(), 'PairOfCleats: Suggest Tests completed.');
assert.deepEqual(
  spawnCalls[3].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'suggest-tests',
    '--json',
    '--repo',
    repoRoot,
    '--max',
    '7',
    '--changed',
    'src/app.ts'
  ]
);

const workspaceStatusSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.workspaceStatus');
inputQueue.push(workspacePath);
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    workspacePath,
    manifestPath: path.join(repoRoot, '.cache', 'workspace_manifest.json'),
    repoSetId: 'workspace-alpha',
    repos: []
  })
});
await extension._test.runOperatorCommand(workspaceStatusSpec);
assert.equal(infoMessages.pop(), 'PairOfCleats: Workspace Status completed.');
assert.deepEqual(
  spawnCalls[4].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'workspace',
    'status',
    '--json',
    '--workspace',
    workspacePath
  ]
);

assert.equal(errorMessages.length, 0, `unexpected errors: ${errorMessages.join('; ')}`);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /files: 4/i.test(event.line)));
assert.ok(outputEvents.some((event) => event.kind === 'append' && /suggestions: 1/i.test(event.line)));
assert.ok(outputEvents.some((event) => event.kind === 'append' && /repoSetId: workspace-alpha/i.test(event.line)));

console.log('vscode workflow runtime test passed');
