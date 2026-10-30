import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { bindSbomSource, releaseSourceErrors, releaseWorkflowSourceErrors, SBOM_SOURCE_PROPERTY } from '../../../tools/release/source-revision.js';
import { setupReadinessGateFixture } from './readiness-gate-fixture.js';
import { runNode } from '../../helpers/run-node.js';

const workflow = parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'));
assert.deepEqual(releaseWorkflowSourceErrors(workflow), []);
for (const [id, job] of Object.entries(workflow.jobs)) {
  if (id === 'prepare') continue;
  const checkout = job.steps?.find(step => step.uses?.startsWith('actions/checkout@'));
  if (!checkout) continue;
  const moved = structuredClone(workflow);
  moved.jobs[id].steps.find(step => step.uses?.startsWith('actions/checkout@')).with.ref = '${{ github.ref }}';
  assert.ok(releaseWorkflowSourceErrors(moved).some(error => error.startsWith(id + ' ')));
  const unwired = structuredClone(workflow);
  unwired.jobs[id].needs = [].concat(job.needs || []).filter(name => name !== 'prepare');
  assert.ok(releaseWorkflowSourceErrors(unwired).some(error => error.includes('depend directly')));
}
assert.deepEqual(releaseSourceErrors('a'.repeat(40), 'A'.repeat(40)), []);
assert.ok(releaseSourceErrors('b'.repeat(40), 'a'.repeat(40)).length);
assert.ok(releaseSourceErrors('abc123', 'a'.repeat(40)).length);
const bound = bindSbomSource({ bomFormat: 'CycloneDX', metadata: { properties: [{ name: 'retained', value: 'yes' }] } }, 'a'.repeat(40));
assert.deepEqual(bound.metadata.properties, [{ name: 'retained', value: 'yes' }, { name: SBOM_SOURCE_PROPERTY, value: 'a'.repeat(40) }]);
assert.throws(() => bindSbomSource(bound, 'b'.repeat(40)), /differs from prepared/);

const fixture = await setupReadinessGateFixture('release-source-qualification', { scenarios: [] });
const invoke = label => runNode([...fixture.baseArgs, '--tui-verify-root', fixture.tuiVerifyRoot,
  '--out-json', fixture.outJsonPath, '--out-md', fixture.outMdPath], label, fixture.root, process.env,
{ stdio: 'pipe', encoding: 'utf8', allowFailure: true });
for (const reportPath of [fixture.prepareReportPath, fixture.runtimeReportPath, fixture.nodeVerifyReportPath,
  path.join(fixture.tuiVerifyRoot, 'windows', 'release_check_report.json')]) {
  const original = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  fixture.writeJson(reportPath, { ...original, observedSourceCommit: 'b'.repeat(40) });
  const result = invoke('reject mixed source release report');
  assert.notEqual(result.status, 0);
  assert.ok(JSON.parse(fs.readFileSync(fixture.outJsonPath, 'utf8')).blockers.some(blocker => blocker.id.endsWith('invalid-shape')));
  fixture.writeJson(reportPath, original);
}
const sbomPath = path.join(fixture.trustRoot, 'node-root.cyclonedx.json');
const original = JSON.parse(fs.readFileSync(sbomPath, 'utf8'));
fixture.writeJson(sbomPath, bindSbomSource({ bomFormat: 'CycloneDX' }, 'b'.repeat(40)));
assert.notEqual(invoke('reject cross-source SBOM').status, 0);
assert.ok(JSON.parse(fs.readFileSync(fixture.outJsonPath, 'utf8')).blockers.some(blocker => blocker.id === 'trust.sboms'));
fixture.writeJson(sbomPath, original);
assert.equal(invoke('accept source-consistent synthetic release evidence').status, 0);
console.log('Release stages and evidence bind to the prepared immutable checkout, including SBOM source identity.');
