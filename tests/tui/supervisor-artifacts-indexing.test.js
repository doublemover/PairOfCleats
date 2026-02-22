#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import { createSupervisorSession } from '../helpers/supervisor-session.js';
import assert from 'node:assert/strict';
import path from 'node:path';

ensureTestingEnv(process.env);

const { events, waitForEvent, send, shutdown, forceKill } = createSupervisorSession();

try {
  await waitForEvent((event) => event.event === 'hello');

  const jobId = 'job-artifacts-1';
  send({
    op: 'job:run',
    jobId,
    title: 'Artifacts',
    argv: ['search', '--help'],
    command: process.execPath,
    args: ['-e', 'process.exit(0)']
  });

  await waitForEvent((event) => event.event === 'job:end' && event.jobId === jobId);
  const artifactsEvent = await waitForEvent((event) => event.event === 'job:artifacts' && event.jobId === jobId);

  assert.equal(artifactsEvent.artifactsIndexed, true);
  assert(Array.isArray(artifactsEvent.artifacts), 'expected artifacts array');
  const historyArtifact = artifactsEvent.artifacts.find((artifact) => artifact.kind === 'metrics:search-history');
  assert.ok(historyArtifact, 'expected search history artifact');
  assert.equal(path.basename(historyArtifact.path), 'searchHistory');

  const buildJobId = 'job-artifacts-2';
  send({
    op: 'job:run',
    jobId: buildJobId,
    title: 'Build Artifacts',
    argv: ['index', 'build', '--help'],
    command: process.execPath,
    args: ['-e', 'process.exit(0)']
  });
  await waitForEvent((event) => event.event === 'job:end' && event.jobId === buildJobId);
  const buildArtifactsEvent = await waitForEvent((event) => event.event === 'job:artifacts' && event.jobId === buildJobId);
  assert.equal(buildArtifactsEvent.artifactsIndexed, true);
  assert.ok(
    (buildArtifactsEvent.artifacts || []).some((artifact) => artifact.kind === 'index:extracted-prose'),
    'expected extracted-prose index artifact in build artifact list'
  );

  await shutdown();

  console.log('supervisor artifacts indexing test passed');
} catch (error) {
  forceKill();
  console.error(error?.message || error);
  process.exit(1);
}
