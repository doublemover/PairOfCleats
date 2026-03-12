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

function createFakeSpawn(spawnCalls, queuedResults, killCalls) {
  return {
    spawn(command, args, options) {
      const result = queuedResults.shift() || {};
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = (signal) => {
        killCalls.push({ command, args, signal });
        if (result.persistent && !result.closed) {
          result.closed = true;
          setImmediate(() => child.emit('close', result.killCode ?? 0));
        }
      };
      spawnCalls.push({ command, args, options, child });
      setImmediate(() => {
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
        if (!result.persistent) {
          child.emit('close', result.code ?? 0);
        }
      });
      return child;
    }
  };
}

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-ops-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'tools', 'index'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'tools', 'index', 'validate.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'export const value = 1;\n');

const configValues = {
  cliPath: '',
  cliArgs: ['--trace'],
  env: {}
};

const outputEvents = [];
const infoMessages = [];
const errorMessages = [];
const spawnCalls = [];
const killCalls = [];
const queuedResults = [];
const registeredCommands = new Map();
const workspaceStateStore = new Map();
const statusBar = {
  text: '',
  tooltip: '',
  command: '',
  shown: 0,
  show() {
    this.shown += 1;
  },
  hide() {},
  dispose() {}
};

const fakeVscode = {
  workspace: {
    workspaceFolders: [{ name: 'repo', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } }],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => folder.uri.fsPath === uri?.fsPath || uri?.fsPath?.startsWith(`${folder.uri.fsPath}${path.sep}`)) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    }
  },
  window: {
    activeTextEditor: { document: { uri: { scheme: 'file', fsPath: path.join(repoRoot, 'src', 'app.ts') } } },
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return { dispose() {} };
        }
      };
      return task({}, token);
    },
    showInformationMessage(message) {
      infoMessages.push(message);
    },
    showErrorMessage(message) {
      errorMessages.push(message);
    },
    async showQuickPick() {
      return null;
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
    },
    createStatusBarItem() {
      return statusBar;
    }
  },
  commands: {
    registerCommand(id, handler) {
      registeredCommands.set(id, handler);
      return { id, handler, dispose() {} };
    }
  },
  Uri: {
    file(fsPath) {
      return { scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') };
    }
  },
  StatusBarAlignment: {
    Left: 1
  },
  ProgressLocation: {
    Notification: 1
  }
};

const fakeContext = {
  subscriptions: [],
  workspaceState: {
    get(key, fallback) {
      return workspaceStateStore.has(key) ? workspaceStateStore.get(key) : fallback;
    },
    async update(key, value) {
      workspaceStateStore.set(key, value);
    }
  }
};

const extension = loadExtensionWithMocks({
  fakeVscode,
  fakeChildProcess: createFakeSpawn(spawnCalls, queuedResults, killCalls)
});

extension.activate(fakeContext);

for (const commandId of [
  'pairofcleats.indexBuild',
  'pairofcleats.indexWatchStart',
  'pairofcleats.indexWatchStop',
  'pairofcleats.indexValidate',
  'pairofcleats.serviceApiStart',
  'pairofcleats.serviceApiStop',
  'pairofcleats.serviceIndexerStart',
  'pairofcleats.serviceIndexerStop'
]) {
  assert.ok(registeredCommands.has(commandId), `missing registered command ${commandId}`);
}

queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    ok: true,
    root: repoRoot,
    strict: true,
    modes: {
      code: { ok: true, path: path.join(repoRoot, 'index-code'), missing: [], warnings: [] }
    },
    sqlite: { enabled: false, ok: true, mode: 'code', issues: [] },
    lmdb: { enabled: false, ok: true, issues: [], warnings: [] },
    warnings: [],
    issues: [],
    hints: []
  })
});
await registeredCommands.get('pairofcleats.indexValidate')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Index Validate completed.');
assert.deepEqual(
  spawnCalls[0].args,
  [
    path.join(repoRoot, 'tools', 'index', 'validate.js'),
    '--json',
    '--repo',
    repoRoot
  ]
);

queuedResults.push({
  code: 0,
  stdout: '[build] done\n'
});
await registeredCommands.get('pairofcleats.indexBuild')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Index Build completed.');
assert.deepEqual(
  spawnCalls[1].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'index',
    'build',
    '--repo',
    repoRoot,
    '--progress',
    'log'
  ]
);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /\[stdout\] \[build\] done/i.test(event.line)));

queuedResults.push({ persistent: true, stdout: '[watch] started\n', killCode: 0 });
await registeredCommands.get('pairofcleats.indexWatchStart')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Index Watch started. Use PairOfCleats: Stop Index Watch to stop it.');
assert.deepEqual(
  spawnCalls[2].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'index',
    'watch',
    '--repo',
    repoRoot,
    '--progress',
    'log'
  ]
);
await registeredCommands.get('pairofcleats.indexWatchStop')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Index Watch stopped.');

queuedResults.push({ persistent: true, stdout: '[api] listening\n', killCode: 0 });
await registeredCommands.get('pairofcleats.serviceApiStart')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Service API started. Use PairOfCleats: Stop Service API to stop it.');
await registeredCommands.get('pairofcleats.serviceApiStop')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Service API stopped.');

queuedResults.push({ persistent: true, stdout: '[indexer] watching\n', killCode: 0 });
await registeredCommands.get('pairofcleats.serviceIndexerStart')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Service Indexer started. Use PairOfCleats: Stop Service Indexer to stop it.');
await registeredCommands.get('pairofcleats.serviceIndexerStop')();
assert.equal(infoMessages.shift(), 'PairOfCleats: Service Indexer stopped.');

assert.equal(errorMessages.length, 0, `unexpected errors: ${errorMessages.join('; ')}`);
assert.equal(killCalls.length, 3, 'expected stop commands to terminate all three persistent children');

console.log('vscode operations runtime test passed');
