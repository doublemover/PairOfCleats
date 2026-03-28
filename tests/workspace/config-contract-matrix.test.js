#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { normalizeIdentityPath } from '../../src/workspace/identity.js';

const makeTempRoot = (suffix) => fs.mkdtemp(path.join(os.tmpdir(), `pairofcleats-workspace-${suffix}-`));

const runConfigParsingCase = async () => {
  const tempRoot = await makeTempRoot('config');
  const workspaceDir = path.join(tempRoot, 'workspace');
  const repoA = path.join(tempRoot, 'repo-a');
  const repoB = path.join(tempRoot, 'repo-b');
  const workspaceFile = path.join(workspaceDir, '.pairofcleats-workspace.jsonc');

  await fs.mkdir(path.join(repoA, 'nested'), { recursive: true });
  await fs.mkdir(repoB, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.writeFile(path.join(repoA, '.pairofcleats.json'), '{}', 'utf8');
  await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{}', 'utf8');

  await fs.writeFile(workspaceFile, `{
    "schemaVersion": 1,
    "name": "  Workspace Parse  ",
    "cacheRoot": "../cache-root",
    "defaults": {
      "enabled": false,
      "priority": 7,
      "tags": [" Team ", "team"]
    },
    "repos": [
      { "root": "../repo-a/nested" },
      { "root": "../repo-b", "alias": "Repo-B", "enabled": true, "priority": 2, "tags": [" API ", "api", ""] }
    ]
  }`, 'utf8');

  const resolved = loadWorkspaceConfig(workspaceFile);
  assert.equal(resolved.schemaVersion, 1);
  assert.equal(resolved.name, 'Workspace Parse');
  assert.equal(resolved.cacheRoot, normalizeIdentityPath(path.join(workspaceDir, '..', 'cache-root')));
  assert.equal(resolved.repos.length, 2);
  assert.equal(resolved.repos[0].enabled, false);
  assert.equal(resolved.repos[0].priority, 7);
  assert.deepEqual(resolved.repos[0].tags, ['team']);
  assert.equal(resolved.repos[1].alias, 'Repo-B');
  assert.deepEqual(resolved.repos[1].tags, ['api']);
  assert.ok(resolved.repoSetId.startsWith('ws1-'));
  assert.ok(resolved.workspaceConfigHash.startsWith('wsc1-'));

  const unknownKeyFile = path.join(workspaceDir, 'workspace-unknown.jsonc');
  await fs.writeFile(unknownKeyFile, `{
    "schemaVersion": 1,
    "repos": [{ "root": "../repo-a", "unknownField": true }]
  }`, 'utf8');
  assert.throws(() => loadWorkspaceConfig(unknownKeyFile), (error) => {
    assert.equal(error.code, WORKSPACE_ERROR_CODES.UNKNOWN_KEY);
    assert.equal(error.field, 'unknownField');
    return true;
  });
};

const runAliasAndTagNormalizationCase = async () => {
  const tempRoot = await makeTempRoot('alias-tags');
  const repoA = path.join(tempRoot, 'repo-a');
  const repoB = path.join(tempRoot, 'repo-b');
  const duplicateAliasFile = path.join(tempRoot, 'workspace-dup-alias.jsonc');
  const normalizeTagsFile = path.join(tempRoot, 'workspace-tags.jsonc');

  await fs.mkdir(repoA, { recursive: true });
  await fs.mkdir(repoB, { recursive: true });
  await fs.writeFile(path.join(repoA, '.pairofcleats.json'), '{}', 'utf8');
  await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{}', 'utf8');

  await fs.writeFile(duplicateAliasFile, `{
    "schemaVersion": 1,
    "repos": [
      { "root": "./repo-a", "alias": "Core" },
      { "root": "./repo-b", "alias": "core" }
    ]
  }`, 'utf8');
  assert.throws(() => loadWorkspaceConfig(duplicateAliasFile), (error) => {
    assert.equal(error.code, WORKSPACE_ERROR_CODES.DUPLICATE_ALIAS);
    return true;
  });

  await fs.writeFile(normalizeTagsFile, `{
    "schemaVersion": 1,
    "defaults": { "tags": [" Team ", "team", ""] },
    "repos": [
      { "root": "./repo-a", "alias": "   ", "tags": ["Service", " service ", "", "CORE"] },
      { "root": "./repo-b" }
    ]
  }`, 'utf8');

  const resolved = loadWorkspaceConfig(normalizeTagsFile);
  assert.equal(resolved.repos[0].alias, null);
  assert.deepEqual(resolved.repos[0].tags, ['core', 'service']);
  assert.deepEqual(resolved.repos[1].tags, ['team']);
};

const runRepoCanonicalizationCases = async () => {
  const tempRoot = await makeTempRoot('canonical');
  const repoRoot = path.join(tempRoot, 'repo');
  const nested = path.join(repoRoot, 'src', 'nested');
  const workspaceFile = path.join(tempRoot, 'workspace.jsonc');

  await fs.mkdir(nested, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{}', 'utf8');
  await fs.writeFile(workspaceFile, `{
    "schemaVersion": 1,
    "repos": [
      { "root": "./repo" },
      { "root": "./repo/src/nested" }
    ]
  }`, 'utf8');
  assert.throws(() => loadWorkspaceConfig(workspaceFile), (error) => {
    assert.equal(error.code, WORKSPACE_ERROR_CODES.DUPLICATE_REPO_ROOT);
    return true;
  });

  const winPathA = normalizeIdentityPath('C:\\Repo\\Svc', { platform: 'win32' });
  const winPathB = normalizeIdentityPath('c:\\repo\\svc', { platform: 'win32' });
  assert.equal(winPathA, winPathB);
};

const runRepoRootMustBeDirectoryCase = async () => {
  const tempRoot = await makeTempRoot('repo-root-file');
  const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
  const notDirectoryPath = path.join(tempRoot, 'repo-root.txt');

  await fs.writeFile(notDirectoryPath, 'not a directory', 'utf8');
  await fs.writeFile(workspacePath, `{
    "schemaVersion": 1,
    "repos": [
      { "root": "./repo-root.txt" }
    ]
  }`, 'utf8');
  assert.throws(() => loadWorkspaceConfig(workspacePath), (error) => {
    assert.equal(error.code, WORKSPACE_ERROR_CODES.REPO_ROOT_NOT_DIRECTORY);
    assert.equal(error.field, 'root');
    return true;
  });
};

const runRepoSetDeterminismCase = async () => {
  const tempRoot = await makeTempRoot('reposet');
  const repoA = path.join(tempRoot, 'repo-a');
  const repoB = path.join(tempRoot, 'repo-b');
  const workspaceA = path.join(tempRoot, 'workspace-a.jsonc');
  const workspaceB = path.join(tempRoot, 'workspace-b.jsonc');

  await fs.mkdir(repoA, { recursive: true });
  await fs.mkdir(repoB, { recursive: true });
  await fs.writeFile(path.join(repoA, '.pairofcleats.json'), '{}', 'utf8');
  await fs.writeFile(path.join(repoB, '.pairofcleats.json'), '{}', 'utf8');

  await fs.writeFile(workspaceA, `{
    "schemaVersion": 1,
    "name": "First",
    "repos": [
      { "root": "./repo-a", "alias": "A", "tags": ["x"], "enabled": true, "priority": 0 },
      { "root": "./repo-b", "alias": "B", "tags": ["y"], "enabled": true, "priority": 0 }
    ]
  }`, 'utf8');
  await fs.writeFile(workspaceB, `{
    "schemaVersion": 1,
    "name": "Second",
    "repos": [
      { "root": "./repo-b", "alias": "Repo Bee", "tags": ["display"], "enabled": false, "priority": 999 },
      { "root": "./repo-a", "alias": "Repo Ay", "tags": ["metadata"], "enabled": true, "priority": -3 }
    ]
  }`, 'utf8');

  const resolvedA = loadWorkspaceConfig(workspaceA);
  const resolvedB = loadWorkspaceConfig(workspaceB);
  assert.equal(resolvedA.repoSetId, resolvedB.repoSetId);
  assert.notEqual(resolvedA.workspaceConfigHash, resolvedB.workspaceConfigHash);
};

const runWindowsCanonicalizationCase = async () => {
  const tempRoot = await makeTempRoot('win-canon');
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoRoot = path.join(tempRoot, 'RepoCase');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');

  const repoVariant = repoRoot.replace('RepoCase', 'REPOCASE');
  try {
    await fs.access(repoVariant);
  } catch {
    await fs.symlink(repoRoot, repoVariant, 'dir');
  }
  const workspaceA = path.join(tempRoot, 'workspace-a.jsonc');
  const workspaceB = path.join(tempRoot, 'workspace-b.jsonc');
  await fs.writeFile(workspaceA, JSON.stringify({
    schemaVersion: 1,
    repos: [{ root: repoRoot }]
  }, null, 2), 'utf8');
  await fs.writeFile(workspaceB, JSON.stringify({
    schemaVersion: 1,
    repos: [{ root: repoVariant }]
  }, null, 2), 'utf8');

  const configA = loadWorkspaceConfig(workspaceA, { platform: 'win32' });
  const configB = loadWorkspaceConfig(workspaceB, { platform: 'win32' });
  const repoA = configA.repos[0];
  const repoB = configB.repos[0];
  assert.equal(repoA.repoRootCanonical, repoB.repoRootCanonical);
  assert.equal(repoA.repoId, repoB.repoId);
  assert.equal(configA.repoSetId, configB.repoSetId);
  assert.equal(getRepoCacheRoot(repoA.repoRootCanonical), getRepoCacheRoot(repoB.repoRootCanonical));

  const duplicateWorkspace = path.join(tempRoot, 'workspace-dup.jsonc');
  await fs.writeFile(duplicateWorkspace, JSON.stringify({
    schemaVersion: 1,
    repos: [{ root: repoRoot }, { root: repoVariant }]
  }, null, 2), 'utf8');
  assert.throws(
    () => loadWorkspaceConfig(duplicateWorkspace, { platform: 'win32' }),
    /Duplicate canonical repo root/i
  );
};

await runConfigParsingCase();
await runAliasAndTagNormalizationCase();
await runRepoCanonicalizationCases();
await runRepoRootMustBeDirectoryCase();
await runRepoSetDeterminismCase();
await runWindowsCanonicalizationCase();

console.log('workspace config contract matrix test passed');
