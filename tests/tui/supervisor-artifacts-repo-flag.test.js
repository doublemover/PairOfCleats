#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getMetricsDir, loadUserConfig } from '../../tools/shared/dict-utils.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const repoRoot = path.join(root, '.testCache', 'tui-supervisor-artifacts-repo-flag');
await fs.mkdir(repoRoot, { recursive: true });

const { waitForEvent, send, shutdown, forceKill } = createSupervisorSession({ root });

try {
  await waitForEvent((event) => event.event === 'hello');
  const jobId = 'job-artifacts-repo-flag';
  send({
    op: 'job:run',
    jobId,
    title: 'Artifacts Repo Flag',
    argv: ['search', '--help', '--repo', repoRoot]
  });

  await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  const artifactsEvent = await waitForEvent((event) => event.event === 'job:artifacts' && event.jobId === jobId);

  assert.equal(artifactsEvent.artifactsIndexed, true);
  const metricsArtifact = (artifactsEvent.artifacts || []).find((artifact) => artifact.kind === 'metrics:search');
  assert.ok(metricsArtifact, 'expected metrics:search artifact');

  const expectedMetricsDir = getMetricsDir(repoRoot, loadUserConfig(repoRoot));
  assert.equal(
    path.resolve(metricsArtifact.path),
    path.resolve(expectedMetricsDir),
    'expected artifacts indexing to honor --repo from argv'
  );

  await shutdown();
  console.log('supervisor artifacts repo flag test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
