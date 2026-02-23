#!/usr/bin/env node
import assert from 'node:assert/strict';
import { runImpactCli } from '../../../src/integrations/tooling/impact.js';
import { createImpactRepoFixture, removeImpactRepoFixture } from '../../helpers/impact-fixture.js';

const seedFixture = createImpactRepoFixture({
  prefix: 'impact-seed-',
  compatibilityKey: 'compat-impact-seed',
  graphRelations: {
    version: 1,
    callGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: {
      nodeCount: 1,
      edgeCount: 0,
      nodes: [{ id: 'src/alpha.js', out: [], in: [] }]
    }
  }
});

const changedFixture = createImpactRepoFixture({
  prefix: 'impact-warning-',
  compatibilityKey: 'compat-impact-warning',
  graphRelations: {
    version: 1,
    callGraph: {
      nodeCount: 1,
      edgeCount: 0,
      nodes: [{ id: 'chunk-a', file: 'src/a.js', out: [], in: [] }]
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  }
});

try {
  const seedPayload = await runImpactCli([
    '--repo',
    seedFixture.repoRoot,
    '--seed',
    'file:src\\alpha.js',
    '--depth',
    '1',
    '--direction',
    'downstream',
    '--json'
  ]);
  assert.equal(seedPayload?.seed?.path, 'src/alpha.js');

  const changedPayload = await runImpactCli([
    '--repo',
    changedFixture.repoRoot,
    '--seed',
    'chunk:chunk-a',
    '--changed',
    'src/alpha.js',
    '--depth',
    '1',
    '--direction',
    'downstream',
    '--json'
  ]);
  assert.equal(
    changedPayload?.warnings?.some((warning) => warning?.code === 'CHANGED_IGNORED'),
    true,
    'expected warning when --changed is ignored because --seed is present'
  );
} finally {
  removeImpactRepoFixture(seedFixture.repoRoot);
  removeImpactRepoFixture(changedFixture.repoRoot);
}

console.log('impact seed/changed behavior test passed');
