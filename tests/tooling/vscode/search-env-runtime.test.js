#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveEnvPath } from '../../../src/shared/env-path.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

import {
  createVsCodeRuntimeHarness,
  prepareVsCodeFixtureWorkspace
} from '../../helpers/vscode/runtime-harness.js';

const originalPath = process.env.PATH;
const originalToken = process.env.PAIROFCLEATS_API_TOKEN;

process.env.PATH = 'process-path';
process.env.PAIROFCLEATS_API_TOKEN = 'process-token';

const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', {
  prefix: 'poc-vscode-env-'
});

const cliHarness = createVsCodeRuntimeHarness({
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  globalConfigValues: {
    env: {
      PAIROFCLEATS_API_TOKEN: 'settings-token',
      CUSTOM_NUMERIC_FLAG: 17,
      CUSTOM_BOOL_FLAG: true
    }
  }
});

try {
  cliHarness.activate();
  cliHarness.inputQueue.push('needle');
  cliHarness.quickPickQueue.push(null);
  cliHarness.queuedResults.push({
    code: 0,
    stdout: JSON.stringify({
      code: [{ file: 'src/app.ts', score: 1, startLine: 1 }]
    })
  });
  await cliHarness.runCommand('pairofcleats.search');

  assert.equal(cliHarness.spawnCalls.length, 1, 'expected one CLI search spawn');
  assert.equal(resolveEnvPath(cliHarness.spawnCalls[0].options.env), 'process-path');
  assert.equal(cliHarness.spawnCalls[0].options.env.PAIROFCLEATS_API_TOKEN, 'settings-token');
  assert.equal(cliHarness.spawnCalls[0].options.env.CUSTOM_NUMERIC_FLAG, '17');
  assert.equal(cliHarness.spawnCalls[0].options.env.CUSTOM_BOOL_FLAG, 'true');
} finally {
  cliHarness.restoreGlobals();
}

const apiHarness = createVsCodeRuntimeHarness({
  globalConfigValues: {
    apiServerUrl: 'http://127.0.0.1:4311',
    apiExecutionMode: 'require',
    env: { PAIROFCLEATS_API_TOKEN: 'settings-token' }
  },
  repoRoot: workspace.root,
  workspaceFolders: [{ name: 'repo', path: workspace.root }],
  configValues: {
    apiExecutionMode: 'cli',
    apiServerUrl: 'http://workspace-unapproved.invalid:4311',
    env: {
      PAIROFCLEATS_API_TOKEN: 'untrusted-workspace-token'
    }
  }
});

const service = prepareServiceMappingFixture(apiHarness, { repoRoot: workspace.root });
try {
  apiHarness.activate();
  apiHarness.inputQueue.push('AuthToken');
  apiHarness.quickPickQueue.push(null);
  apiHarness.queuedFetchResults.push({
    status: 200,
    json: {
      ok: true,
      capabilities: {
        search: true
      }
    }
  });
  apiHarness.queuedFetchResults.push({ status: 200, json: service.status });
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

  assert.equal(apiHarness.fetchCalls.length, 3, 'expected capabilities, qualified service status and search');
  assert.equal(
    apiHarness.fetchCalls[0].options.headers.Authorization,
    'Bearer settings-token'
  );
  assert.equal(
    apiHarness.fetchCalls[1].options.headers.Authorization,
    'Bearer settings-token'
  );
  assert.equal(apiHarness.fetchCalls[2].options.headers.Authorization, 'Bearer settings-token');
  assert.ok(apiHarness.fetchCalls.every(call => String(call.url).startsWith('http://127.0.0.1:4311/')),
    'workspace destination and credential overrides remain non-authoritative');
} finally {
  apiHarness.restoreGlobals();
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalToken === undefined) {
    delete process.env.PAIROFCLEATS_API_TOKEN;
  } else {
    process.env.PAIROFCLEATS_API_TOKEN = originalToken;
  }
}

console.log('vscode search env runtime test passed');
