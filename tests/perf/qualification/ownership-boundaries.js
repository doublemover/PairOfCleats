import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';
await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2], 'An explicit fresh output directory is required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()), observations = [];
assert.equal(source.state, 'clean-revision', 'Qualification requires a committed, clean source identity.');
const controls = { manifest: ['ordinary-read', 'ordinary-close', 'ordinary-close-failure', 'ordinary-siblings',
  'ordinary-siblings-close-failure', 'ordinary-preabort', 'ordinary-sealed', 'borrowed-read', 'borrowed-close',
  'borrowed-close-failure', 'borrowed-siblings', 'borrowed-siblings-close-failure', 'borrowed-preabort', 'borrowed-sealed'],
filter: ['key-admission', 'key-read', 'key-close', 'payload-admission', 'payload-read', 'payload-close', 'persist-key',
  'sqlite-fallback', 'sqlite-no-fallback', 'cancelled-key-read', 'cancelled-payload-read'],
probe: ['shared-child-read', 'shared-root-read', 'api-child-read', 'api-root-read', 'mcp-child-read', 'mcp-root-read',
  'shared-child-close', 'shared-root-close', 'api-child-close', 'api-root-close', 'mcp-child-close', 'mcp-root-close'] };
for (const [scenario, cases] of Object.entries(controls)) for (const selected of cases) {
  const name = scenario + '-' + selected, destination = path.join(output, name + '.json');
  const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/ownership-boundary-caps.js', scenario, selected, destination],
    receiptPath: path.join(output, name + '-invocation.json') });
  assert.equal(result.stderr, ''); assert.equal(result.outputCapture.stdout.truncated, false);
  const report = JSON.parse(await fs.readFile(destination, 'utf8'));
  assert.equal(report.status, 'passed'); assert.equal(report.selected, selected);
  const abort = report.events.find(event => event.phase === 'abort-requested');
  const released = report.events.find(event => event.phase === 'imposed-phase-gate-released');
  const completion = report.events.find(event => event.phase === 'public-cancellation-completion');
  observations.push({ scenario, selected, capsuleMs: result.durationMs, report,
    durations: { controlledHoldMs: abort && released ? released.atMs - abort.atMs : null,
      releaseToPublicCompletionMs: released && completion ? completion.atMs - released.atMs : null } });
  console.log(JSON.stringify({ name, capsuleMs: result.durationMs }));
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { historicalAuthorWorkspace: true, source, observations,
  scope: '37 serial original-owner controls,30s per child;no retries;actual phase timestamps and original descriptor/session counts',
  limits: 'controlled holds are distinct from native drain and clean latency;unknown synchronous close remains unresolved and is never retried by fd number' }, { createOnly: true });
