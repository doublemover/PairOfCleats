import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runNode } from '../../helpers/run-node.js';
import { setupReadinessGateFixture } from './readiness-gate-fixture.js';

const fixture = await setupReadinessGateFixture('release-readiness-missing-workflow', { scenarios: [] });
const original = JSON.parse(fs.readFileSync(fixture.ciStatusesPath, 'utf8'));
for (const omitted of [null, 'CI', 'CI Long']) {
  const status = { ...original, workflows: original.workflows.filter(entry => entry.workflow !== omitted) };
  fs.writeFileSync(fixture.ciStatusesPath, JSON.stringify(status));
  const output = path.join(fixture.fixtureDir, 'readiness', `${omitted || 'complete'}.json`);
  const result = runNode([...fixture.baseArgs, '--tui-verify-root', fixture.tuiVerifyRoot,
    '--out-json', output, '--out-md', `${output}.md`], `release without ${omitted || 'omission'}`,
  fixture.root, process.env, { stdio: 'pipe', allowFailure: true });
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.status, omitted ? 1 : 0, result.stderr || result.stdout);
  assert.equal(report.ok, !omitted);
  assert.deepEqual(report.blockers.map(blocker => blocker.id), omitted ? [`ci.${omitted.replace(/\s+/g, '-').toLowerCase()}`] : []);
}
console.log('Release readiness succeeds with both exact-SHA workflows and fails when either CI or CI Long is missing.');
