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
      const result = queuedResults.shift();
      if (result?.throw) {
        throw result.throw;
      }
      spawnCalls.push({ command, args, options });
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
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

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-vscode-operator-'));
fs.mkdirSync(path.join(repoRoot, 'bin'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'tools', 'config'), { recursive: true });
fs.mkdirSync(path.join(repoRoot, 'tools', 'index'), { recursive: true });
fs.writeFileSync(path.join(repoRoot, 'bin', 'pairofcleats.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'tools', 'config', 'dump.js'), 'console.log("ok");');
fs.writeFileSync(path.join(repoRoot, 'tools', 'index', 'report-artifacts.js'), 'console.log("ok");');

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
const registeredCommands = [];
const spawnCalls = [];
const queuedResults = [];
const fakeVscode = {
  workspace: {
    workspaceFolders: [{ name: 'repo', uri: { scheme: 'file', fsPath: repoRoot, path: repoRoot.replace(/\\/g, '/') } }],
    getWorkspaceFolder(uri) {
      return this.workspaceFolders.find((folder) => folder.uri.fsPath === uri?.fsPath) || null;
    },
    getConfiguration() {
      return createFakeConfiguration(configValues);
    }
  },
  window: {
    activeTextEditor: null,
    async withProgress(_options, task) {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested() {
          return { dispose() {} };
        }
      };
      return task({}, token);
    },
    showErrorMessage(message) {
      errorMessages.push(message);
    },
    showInformationMessage(message) {
      infoMessages.push(message);
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
    }
  },
  Uri: {
    file(fsPath) {
      return { scheme: 'file', fsPath, path: fsPath.replace(/\\/g, '/') };
    }
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
  'pairofcleats.search',
  'pairofcleats.setup',
  'pairofcleats.bootstrap',
  'pairofcleats.doctor',
  'pairofcleats.configDump',
  'pairofcleats.indexHealth'
]) {
  assert.ok(registeredCommands.includes(commandId), `missing registered command ${commandId}`);
}

const configDumpSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.configDump');
queuedResults.push({
  code: 0,
  stdout: JSON.stringify({
    repoRoot,
    policy: {
      quality: { value: 'max', source: 'config' }
    },
    derived: {
      cacheRoot: path.join(repoRoot, '.cache'),
      repoCacheRoot: path.join(repoRoot, '.cache', 'repo'),
      mcp: {
        mode: 'auto',
        modeSource: 'default',
        sdkAvailable: true
      }
    }
  })
});
await extension._test.runOperatorCommand(configDumpSpec);
assert.equal(infoMessages.pop(), 'PairOfCleats: Config Dump completed.');
assert.deepEqual(
  spawnCalls[0].args,
  [
    path.join(repoRoot, 'tools', 'config', 'dump.js'),
    '--json',
    '--repo',
    repoRoot
  ]
);
assert.equal(spawnCalls[0].command, process.execPath);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /quality: max \(config\)/i.test(event.line)));

const doctorSpec = extension._test.OPERATOR_COMMAND_SPECS.find((spec) => spec.id === 'pairofcleats.doctor');
queuedResults.push({
  code: 1,
  stdout: JSON.stringify({
    repoRoot,
    summary: { status: 'error' },
    identity: { chunkUid: { available: false } },
    xxhash: { backend: 'js' },
    providers: [{ id: 'gopls', status: 'error', enabled: true }],
    scm: { provider: 'git', annotateEnabled: false }
  })
});
await extension._test.runOperatorCommand(doctorSpec);
assert.equal(
  errorMessages.pop(),
  'PairOfCleats: Tooling Doctor reported issues. See PairOfCleats output for details.'
);
assert.deepEqual(
  spawnCalls[1].args,
  [
    path.join(repoRoot, 'bin', 'pairofcleats.js'),
    '--trace',
    'tooling',
    'doctor',
    '--json',
    '--repo',
    repoRoot
  ]
);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /providers: 1 total, 0 warn, 1 error/i.test(event.line)));
assert.ok(outputEvents.some((event) => event.kind === 'show'));

queuedResults.push({
  throw: new Error('sync spawn failure')
});
await extension._test.runOperatorCommand(configDumpSpec);
assert.match(errorMessages.pop(), /Config Dump failed to start/i);
assert.ok(outputEvents.some((event) => event.kind === 'append' && /sync spawn failure/i.test(event.line)));

console.log('vscode operator runtime test passed');
