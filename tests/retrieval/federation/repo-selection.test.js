#!/usr/bin/env node
import assert from 'node:assert/strict';
import { selectWorkspaceRepos } from '../../../src/retrieval/federation/select.js';

const workspaceConfig = {
  repos: [
    {
      repoId: 'repo-a',
      alias: 'alpha',
      repoRootCanonical: '/tmp/repo-a',
      enabled: true,
      priority: 2,
      tags: ['service', 'api']
    },
    {
      repoId: 'repo-b',
      alias: 'beta',
      repoRootCanonical: '/tmp/repo-b',
      enabled: false,
      priority: 100,
      tags: ['batch']
    },
    {
      repoId: 'repo-c',
      alias: 'gamma',
      repoRootCanonical: '/tmp/repo-c',
      enabled: true,
      priority: 1,
      tags: ['service']
    }
  ]
};

const explicitDisabled = selectWorkspaceRepos({
  workspaceConfig,
  select: ['beta'],
  includeDisabled: false
});
assert.ok(
  explicitDisabled.selectedRepos.some((repo) => repo.repoId === 'repo-b'),
  'explicit --select should include disabled repos even when includeDisabled=false'
);

const tagged = selectWorkspaceRepos({
  workspaceConfig,
  tag: ['service']
});
assert.deepEqual(
  tagged.selectedRepos.map((repo) => repo.repoId),
  ['repo-a', 'repo-c'],
  '--tag should include repos with any matching tag'
);

const filtered = selectWorkspaceRepos({
  workspaceConfig,
  includeDisabled: true,
  repoFilter: ['repo-*']
});
assert.deepEqual(
  filtered.selectedRepos.map((repo) => repo.repoId),
  ['repo-b', 'repo-a', 'repo-c'],
  'selection ordering should be deterministic by priority, alias, repoId'
);

console.log('federation repo selection test passed');
