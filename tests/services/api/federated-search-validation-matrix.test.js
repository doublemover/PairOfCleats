#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createFederatedTempRoot,
  startFederatedApiServer,
  writeFederatedWorkspaceConfig
} from '../../helpers/federated-api.js';

applyTestEnv();

const startFederatedValidationServer = async (options) => {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await startFederatedApiServer(options);
    } catch (error) {
      const message = String(error?.message || error || '');
      attempts.push(message);
      const shouldRetry = attempt === 0 && /api-server exited before startup/i.test(message);
      if (!shouldRetry) {
        if (attempts.length > 1) {
          error.message = `${message}\n\nstartup attempts:\n${attempts.join('\n---\n')}`;
        }
        throw error;
      }
    }
  }
  throw new Error(`api-server startup failed after retry:\n${attempts.join('\n---\n')}`);
};

const createValidationFixture = async () => {
  const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-');
  const allowedRoot = path.join(tempRoot, 'allowed');
  const blockedRoot = path.join(tempRoot, 'blocked');
  const defaultRepo = path.join(allowedRoot, 'repo-default');
  const cacheRoot = path.join(allowedRoot, 'cache');

  await fs.mkdir(defaultRepo, { recursive: true });
  await fs.mkdir(blockedRoot, { recursive: true });

  const blockedRepo = path.join(blockedRoot, 'repo-blocked');
  await fs.mkdir(blockedRepo, { recursive: true });

  const workspaceOutsideAllowlist = path.join(allowedRoot, '.workspace-outside-allowlist.jsonc');
  await writeFederatedWorkspaceConfig(workspaceOutsideAllowlist, {
    schemaVersion: 1,
    cacheRoot: './cache',
    repos: [
      { root: './repo-default', alias: 'allowed' },
      { root: '../blocked/repo-blocked', alias: 'blocked' }
    ]
  });

  const notDirectory = path.join(allowedRoot, 'repo-root.txt');
  await fs.writeFile(notDirectory, 'not a directory', 'utf8');
  const workspaceRepoRootNotDirectory = path.join(allowedRoot, '.workspace-repo-root-directory.jsonc');
  await writeFederatedWorkspaceConfig(workspaceRepoRootNotDirectory, {
    schemaVersion: 1,
    cacheRoot: './cache',
    repos: [
      { root: './repo-root.txt', alias: 'bad-root' }
    ]
  });

  const workspaceCacheOutsideAllowlist = path.join(allowedRoot, '.workspace-cache-outside-allowlist.jsonc');
  await writeFederatedWorkspaceConfig(workspaceCacheOutsideAllowlist, {
    schemaVersion: 1,
    cacheRoot: '../blocked/cache',
    repos: [
      { root: './repo-default', alias: 'sample' }
    ]
  });

  const cacheLinkPath = path.join(allowedRoot, 'cache-link');
  await fs.symlink(blockedRoot, cacheLinkPath, process.platform === 'win32' ? 'junction' : 'dir');
  const workspaceCacheSymlinkEscape = path.join(allowedRoot, '.workspace-cache-symlink-escape.jsonc');
  await writeFederatedWorkspaceConfig(workspaceCacheSymlinkEscape, {
    schemaVersion: 1,
    cacheRoot: './cache-link/federated-cache',
    repos: [
      { root: './repo-default', alias: 'sample' }
    ]
  });

  const workspaceDefault = path.join(allowedRoot, '.workspace-default.jsonc');
  await writeFederatedWorkspaceConfig(workspaceDefault, {
    schemaVersion: 1,
    cacheRoot: './cache',
    repos: [
      { root: './repo-default', alias: 'sample' }
    ]
  });

  return {
    tempRoot,
    allowedRoot,
    blockedRoot,
    defaultRepo,
    blockedRepo,
    cacheRoot,
    workspaceOutsideAllowlist,
    workspaceRepoRootNotDirectory,
    workspaceCacheOutsideAllowlist,
    workspaceCacheSymlinkEscape,
    workspaceDefault
  };
};

const fixture = await createValidationFixture();

const cases = [
  {
    name: 'workspaceId requests are rejected until workspacePath support exists',
    body: {
      workspaceId: 'ws1-demo',
      query: 'sample'
    },
    assertResponse(response) {
      assert.equal(response.status, 400);
      assert.equal(response.body?.ok, false);
      assert.equal(response.body?.code, 'INVALID_REQUEST');
      const errors = Array.isArray(response.body?.errors) ? response.body.errors : [];
      assert.ok(errors.some((entry) => String(entry).includes('workspacePath')));
    }
  },
  {
    name: 'workspace repos outside the allowlist return forbidden',
    body: {
      workspacePath: fixture.workspaceOutsideAllowlist,
      query: 'allowlist'
    },
    assertResponse(response) {
      assert.equal(response.status, 403);
      assert.equal(response.body?.ok, false);
      assert.equal(response.body?.code, 'FORBIDDEN');
    }
  },
  {
    name: 'workspace repo roots must be directories',
    body: {
      workspacePath: fixture.workspaceRepoRootNotDirectory,
      query: 'directory-validation'
    },
    assertResponse(response) {
      assert.equal(response.status, 400);
      assert.equal(response.body?.ok, false);
      assert.equal(response.body?.code, 'INVALID_REQUEST');
      assert.match(String(response.body?.message || ''), /must be a directory/i);
    }
  },
  {
    name: 'workspace cache roots outside the allowlist return forbidden',
    body: {
      workspacePath: fixture.workspaceCacheOutsideAllowlist,
      query: 'cache-root-allowlist'
    },
    assertResponse(response) {
      assert.equal(response.status, 403);
      assert.equal(response.body?.ok, false);
      assert.equal(response.body?.code, 'FORBIDDEN');
    }
  },
  {
    name: 'workspace cache-root symlink escapes return forbidden',
    body: {
      workspacePath: fixture.workspaceCacheSymlinkEscape,
      query: 'cache-root-symlink-escape'
    },
    assertResponse(response) {
      assert.equal(response.status, 403);
      assert.equal(response.body?.ok, false);
      assert.equal(response.body?.code, 'FORBIDDEN');
    }
  },
  {
    name: 'invalid cohort selectors are returned as client errors',
    body: {
      workspacePath: fixture.workspaceDefault,
      query: 'cohort-client-error',
      cohort: ['missing-cohort'],
      search: {
        mode: 'code',
        top: 5
      }
    },
    assertResponse(response) {
      assert.equal(response.status, 400);
      assert.equal(response.body?.ok, false);
      assert.equal(response.body?.code, 'INVALID_REQUEST');
    }
  },
  {
    name: 'empty federated selections redact absolute paths from responses',
    body: {
      workspacePath: fixture.workspaceDefault,
      query: 'greet',
      select: {
        tags: ['does-not-exist']
      },
      search: {
        mode: 'code',
        top: 5
      }
    },
    assertResponse(response) {
      assert.equal(response.status, 200);
      assert.equal(response.body?.ok, true);
      assert.deepEqual(response.body?.code || [], []);
      const serialized = JSON.stringify(response.body);
      assert.equal(serialized.includes(fixture.defaultRepo), false);
      assert.equal(serialized.includes(fixture.workspaceDefault), false);
      assert.equal(serialized.includes(fixture.cacheRoot), false);
    }
  },
  {
    name: 'limits.perRepoTop accepts zero without becoming an invalid request',
    body: {
      workspacePath: fixture.workspaceDefault,
      query: 'per-repo-top-zero',
      limits: {
        perRepoTop: 0,
        concurrency: 1
      }
    },
    assertResponse(response) {
      assert.notEqual(response.status, 400);
      assert.notEqual(response.body?.code, 'INVALID_REQUEST');
      if (response.status === 200) {
        assert.equal(response.body?.ok, true);
        assert.equal(response.body?.backend, 'federated');
      }
    }
  }
];

const { serverInfo, requestJson, stop } = await startFederatedValidationServer({
  repoRoot: fixture.defaultRepo,
  allowedRoots: [fixture.allowedRoot],
  envOverrides: {
    PAIROFCLEATS_CACHE_ROOT: fixture.cacheRoot
  }
});

try {
  for (const entry of cases) {
    const response = await requestJson(
      'POST',
      '/search/federated',
      entry.body,
      serverInfo
    );
    entry.assertResponse(response);
  }
} finally {
  await stop();
}

console.log('API federated search validation matrix test passed');
