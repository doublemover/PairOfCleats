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

const cases = [
  {
    name: 'workspaceId requests are rejected until workspacePath support exists',
    async setup() {
      const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-wsid-');
      const repoRoot = path.join(tempRoot, 'repo');
      await fs.mkdir(repoRoot, { recursive: true });
      return {
        repoRoot,
        allowedRoots: [tempRoot],
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
      };
    }
  },
  {
    name: 'workspace repos outside the allowlist return forbidden',
    async setup() {
      const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-workspace-allowlist-');
      const allowedRoot = path.join(tempRoot, 'allowed');
      const blockedRoot = path.join(tempRoot, 'blocked');
      const defaultRepo = path.join(allowedRoot, 'repo-default');
      const blockedRepo = path.join(blockedRoot, 'repo-blocked');
      const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

      await fs.mkdir(defaultRepo, { recursive: true });
      await fs.mkdir(blockedRepo, { recursive: true });
      await writeFederatedWorkspaceConfig(workspacePath, {
        schemaVersion: 1,
        cacheRoot: './cache',
        repos: [
          { root: './repo-default', alias: 'allowed' },
          { root: '../blocked/repo-blocked', alias: 'blocked' }
        ]
      });

      return {
        repoRoot: defaultRepo,
        allowedRoots: [allowedRoot],
        body: {
          workspacePath,
          query: 'allowlist'
        },
        assertResponse(response) {
          assert.equal(response.status, 403);
          assert.equal(response.body?.ok, false);
          assert.equal(response.body?.code, 'FORBIDDEN');
        }
      };
    }
  },
  {
    name: 'workspace repo roots must be directories',
    async setup() {
      const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-repo-root-directory-');
      const allowedRoot = path.join(tempRoot, 'allowed');
      const defaultRepo = path.join(allowedRoot, 'repo-default');
      const notDirectory = path.join(allowedRoot, 'repo-root.txt');
      const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

      await fs.mkdir(defaultRepo, { recursive: true });
      await fs.writeFile(notDirectory, 'not a directory', 'utf8');
      await writeFederatedWorkspaceConfig(workspacePath, {
        schemaVersion: 1,
        cacheRoot: './cache',
        repos: [
          { root: './repo-root.txt', alias: 'bad-root' }
        ]
      });

      return {
        repoRoot: defaultRepo,
        allowedRoots: [allowedRoot],
        body: {
          workspacePath,
          query: 'directory-validation'
        },
        assertResponse(response) {
          assert.equal(response.status, 400);
          assert.equal(response.body?.ok, false);
          assert.equal(response.body?.code, 'INVALID_REQUEST');
          assert.match(String(response.body?.message || ''), /must be a directory/i);
        }
      };
    }
  },
  {
    name: 'workspace cache roots outside the allowlist return forbidden',
    async setup() {
      const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-cache-allowlist-');
      const allowedRoot = path.join(tempRoot, 'allowed');
      const blockedRoot = path.join(tempRoot, 'blocked');
      const repoRoot = path.join(allowedRoot, 'repo');
      const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

      await fs.mkdir(repoRoot, { recursive: true });
      await fs.mkdir(blockedRoot, { recursive: true });
      await writeFederatedWorkspaceConfig(workspacePath, {
        schemaVersion: 1,
        cacheRoot: '../blocked/cache',
        repos: [
          { root: './repo', alias: 'sample' }
        ]
      });

      return {
        repoRoot,
        allowedRoots: [allowedRoot],
        body: {
          workspacePath,
          query: 'cache-root-allowlist'
        },
        assertResponse(response) {
          assert.equal(response.status, 403);
          assert.equal(response.body?.ok, false);
          assert.equal(response.body?.code, 'FORBIDDEN');
        }
      };
    }
  },
  {
    name: 'workspace cache-root symlink escapes return forbidden',
    async setup() {
      const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-cache-symlink-');
      const allowedRoot = path.join(tempRoot, 'allowed');
      const blockedRoot = path.join(tempRoot, 'blocked');
      const repoRoot = path.join(allowedRoot, 'repo');
      const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');
      const cacheLinkPath = path.join(allowedRoot, 'cache-link');

      await fs.mkdir(repoRoot, { recursive: true });
      await fs.mkdir(blockedRoot, { recursive: true });
      await fs.symlink(blockedRoot, cacheLinkPath, process.platform === 'win32' ? 'junction' : 'dir');
      await writeFederatedWorkspaceConfig(workspacePath, {
        schemaVersion: 1,
        cacheRoot: './cache-link/federated-cache',
        repos: [
          { root: './repo', alias: 'sample' }
        ]
      });

      return {
        repoRoot,
        allowedRoots: [allowedRoot],
        body: {
          workspacePath,
          query: 'cache-root-symlink-escape'
        },
        assertResponse(response) {
          assert.equal(response.status, 403);
          assert.equal(response.body?.ok, false);
          assert.equal(response.body?.code, 'FORBIDDEN');
        }
      };
    }
  },
  {
    name: 'invalid cohort selectors are returned as client errors',
    async setup() {
      const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-validation-client-errors-');
      const repoRoot = path.join(tempRoot, 'repo');
      const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

      await fs.mkdir(repoRoot, { recursive: true });
      await writeFederatedWorkspaceConfig(workspacePath, {
        schemaVersion: 1,
        cacheRoot: './cache',
        repos: [
          { root: './repo', alias: 'sample' }
        ]
      });

      return {
        repoRoot,
        allowedRoots: [tempRoot],
        body: {
          workspacePath,
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
      };
    }
  }
];

for (const entry of cases) {
  const setup = await entry.setup();
  const { serverInfo, requestJson, stop } = await startFederatedApiServer({
    repoRoot: setup.repoRoot,
    allowedRoots: setup.allowedRoots
  });
  try {
    const response = await requestJson(
      'POST',
      '/search/federated',
      setup.body,
      serverInfo
    );
    setup.assertResponse(response);
  } finally {
    await stop();
  }
}

console.log('API federated search validation matrix test passed');
