#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRepoIdentity } from '../../../tools/reports/show-throughput/analysis.js';

assert.equal(
  resolveRepoIdentity({
    payload: { repo: { root: '/home/user/projects/PairOfCleats' } },
    file: 'pairofcleats.json'
  }),
  'PairOfCleats'
);

assert.equal(
  resolveRepoIdentity({
    payload: { repo: { root: '/usr' } },
    file: 'benchmark-repo.json'
  }),
  'benchmark-repo',
  'generic path identities should fall back to file identity'
);

assert.equal(
  resolveRepoIdentity({
    payload: { artifacts: { repo: { cacheRoot: '/var/cache/pairofcleats/repos' } } },
    file: 'my-repo.json'
  }),
  'my-repo',
  'cache-root fallback should not leak generic path segments as repo identity'
);

assert.equal(
  resolveRepoIdentity({
    payload: { repo: { root: 'my-explicit-repo-id' } },
    file: 'ignored.json'
  }),
  'my-explicit-repo-id'
);

console.log('show-throughput repo identity test passed');
