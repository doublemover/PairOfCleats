#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getMetricsDir, loadUserConfig } from '../../tools/shared/dict-utils.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const supervisorPath = path.join(root, 'tools', 'tui', 'supervisor.js');
const repoRoot = path.join(root, '.testCache', 'tui-supervisor-artifacts-repo-flag');
await fs.mkdir(repoRoot, { recursive: true });

const child = spawn(process.execPath, [supervisorPath], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe']
});
child.stderr.on('data', () => {});

const events = [];
let carry = '';
child.stdout.on('data', (chunk) => {
  const text = `${carry}${String(chunk)}`.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parts = text.split('\n');
  carry = parts.pop() || '';
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    events.push(JSON.parse(trimmed));
  }
});

const waitFor = async (predicate, timeoutMs = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timeout waiting for supervisor event');
};

const send = (payload) => {
  child.stdin.write(`${JSON.stringify({ proto: 'poc.tui@1', ...payload })}\n`);
};

try {
  await waitFor((event) => event.event === 'hello');
  const jobId = 'job-artifacts-repo-flag';
  send({
    op: 'job:run',
    jobId,
    title: 'Artifacts Repo Flag',
    argv: ['search', '--help', '--repo', repoRoot]
  });

  await waitFor((event) => event.event === 'job:end' && event.jobId === jobId);
  const artifactsEvent = await waitFor((event) => event.event === 'job:artifacts' && event.jobId === jobId);

  assert.equal(artifactsEvent.artifactsIndexed, true);
  const metricsArtifact = (artifactsEvent.artifacts || []).find((artifact) => artifact.kind === 'metrics:search');
  assert.ok(metricsArtifact, 'expected metrics:search artifact');

  const expectedMetricsDir = getMetricsDir(repoRoot, loadUserConfig(repoRoot));
  assert.equal(
    path.resolve(metricsArtifact.path),
    path.resolve(expectedMetricsDir),
    'expected artifacts indexing to honor --repo from argv'
  );

  send({ op: 'shutdown', reason: 'test_complete' });
  await new Promise((resolve) => child.once('exit', resolve));
  console.log('supervisor artifacts repo flag test passed');
} catch (error) {
  try { child.kill('SIGKILL'); } catch {}
  console.error(error?.message || error);
  process.exit(1);
}
