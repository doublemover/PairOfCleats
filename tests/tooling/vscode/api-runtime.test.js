#!/usr/bin/env node
import assert from 'node:assert/strict';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';

import {
  createVsCodeRuntimeHarness,
  prepareVsCodeFixtureWorkspace
} from '../../helpers/vscode/runtime-harness.js';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-api-'
});

const remoteWorkspaceUri = {
  scheme: 'vscode-remote',
  fsPath: '/workspace/repo',
  path: '/workspace/repo',
  toString() {
    return `${this.scheme}:${this.path}`;
  }
};
const remoteFileUri = {
  scheme: 'vscode-remote',
  fsPath: '/workspace/repo/src/app.ts',
  path: '/workspace/repo/src/app.ts',
  toString() {
    return `${this.scheme}:${this.path}`;
  }
};

const apiHarness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'remote', uri: remoteWorkspaceUri }],
  activeEditor: { document: { uri: remoteFileUri } },
  configValues: {
    apiServerUrl: 'http://127.0.0.1:4311',
    apiExecutionMode: 'require',
    apiTimeoutMs: 4321,
    searchMode: 'code'
  }
});
const runtimeManifest = getRuntimeCapabilityManifest({
  runtimeCapabilities: {
    watcher: { chokidar: false, parcel: false },
    regex: { re2: false, re2js: false },
    hash: { nodeRsXxhash: false, wasmXxhash: false },
    compression: { gzip: true, zstd: false },
    extractors: { pdf: false, docx: false },
    mcp: { sdk: false, legacy: true },
    externalBackends: { tantivy: false, lancedb: false },
    nativeAccel: { enabled: false, runtimeKind: 'js', abiVersion: 1, featureBits: 0 }
  }
});

try {
  apiHarness.activate();
  apiHarness.inputQueue.push('AuthToken');
  apiHarness.quickPickQueue.push(null);
  apiHarness.queuedFetchResults.push({
    status: 200,
    json: {
      ok: true,
      runtimeManifest
    }
  });
  apiHarness.queuedFetchResults.push({
    status: 200,
    json: {
      ok: true,
      result: {
        code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
      }
    }
  });
  await apiHarness.runCommand('pairofcleats.search');

  assert.equal(apiHarness.spawnCalls.length, 0, 'API search should not spawn CLI');
  assert.equal(apiHarness.fetchCalls.length, 2, 'API search should probe capabilities then search');
  assert.ok(String(apiHarness.fetchCalls[0].url).endsWith('/capabilities'));
  assert.ok(String(apiHarness.fetchCalls[1].url).endsWith('/search'));
  const postedPayload = JSON.parse(String(apiHarness.fetchCalls[1].options.body || '{}'));
  assert.equal(postedPayload.repo, '/workspace/repo');
  assert.equal(postedPayload.query, 'AuthToken');
  const history = apiHarness.workspaceStateStore.get('pairofcleats.searchHistory');
  assert.equal(history.length, 1);
  assert.equal(history[0].invocation.kind, 'api-search');
  assert.equal(history[0].invocation.baseUrl, 'http://127.0.0.1:4311');
  assert.equal(history[0].invocation.timeoutMs, 4321);
  assert.equal(history[0].invocation.payload.query, 'AuthToken');
  assert.equal(history[0].repoUri, 'vscode-remote:/workspace/repo');

  apiHarness.queuedFetchResults.push({
    status: 200,
    json: {
      ok: true,
      result: {
        code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
      }
    }
  });
  await apiHarness.runCommand('pairofcleats.rerunResultSet', history[0]);
  assert.equal(apiHarness.fetchCalls.length, 3, 'rerun should reuse API invocation');
  assert.ok(String(apiHarness.fetchCalls[2].url).endsWith('/search'));

  apiHarness.queuedFetchResults.push({
    status: 200,
    json: {
      ok: true,
      status: {
        repo: {
          root: '/workspace/repo',
          cacheRoot: '/workspace/repo/.cache',
          totalBytes: 0,
          sqlite: { code: true, prose: false, extractedProse: false, records: false }
        },
        health: { issues: [], hints: [] }
      }
    }
  });
  await apiHarness.runCommand('pairofcleats.indexHealth');
  assert.equal(apiHarness.spawnCalls.length, 0, 'API index health should not spawn CLI');
  assert.ok(
    apiHarness.fetchCalls.some((call) => String(call.url).includes('/status?repo=')),
    'API index health should issue a status request'
  );
  assert.ok(apiHarness.infoMessages.some((message) => /Index Health completed/i.test(message)));

  await apiHarness.extension._test.runExplainSearch();
  assert.ok(apiHarness.errorMessages.some((message) => /API mode is not supported for explain search/i.test(message)));
} finally {
  apiHarness.restoreGlobals();
}

const preferHarness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  configValues: {
    apiServerUrl: 'http://127.0.0.1:4311',
    apiExecutionMode: 'prefer',
    cliArgs: ['--trace']
  }
});

try {
  preferHarness.activate();
  preferHarness.inputQueue.push('fallback query');
  preferHarness.quickPickQueue.push(null);
  preferHarness.queuedFetchResults.push({
    status: 500,
    json: {
      message: 'capabilities offline'
    }
  });
  preferHarness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
    })
  });
  await preferHarness.runCommand('pairofcleats.search');
  assert.equal(preferHarness.fetchCalls.length, 1, 'prefer mode should still probe API first');
  assert.equal(preferHarness.spawnCalls.length, 1, 'prefer mode should fall back to CLI');
  assert.ok(preferHarness.outputEvents.some((event) => event.kind === 'append' && /capabilities offline/i.test(event.line)));
} finally {
  preferHarness.restoreGlobals();
}

console.log('vscode api runtime test passed');
