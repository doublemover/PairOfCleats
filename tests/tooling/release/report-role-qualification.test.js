import assert from 'node:assert/strict';
import { expectedReleaseChecks, qualifyReleaseReport } from '../../../tools/release/report-contract.js';
import { loadShippedSurfaces } from '../../../tools/release/surfaces.js';

const root = process.cwd();
const report = role => ({ executionMode: 'executed', releaseVersion: 'fixture', observedSourceCommit: 'a'.repeat(40),
  shippedSurfaces: loadShippedSurfaces(root).surfaces.map(surface => ({ ...surface,
    releaseCheckStepIds: surface.releaseCheck.steps.map(step => step.id) })),
  checks: expectedReleaseChecks(root, role).map(step => ({ ...step, status: 'passed', exitCode: 0 })) });
for (const role of ['prepare', 'runtime', 'nodeVerify', 'tuiVerify']) {
  const positive = report(role);
  assert.deepEqual(qualifyReleaseReport(positive, { root, role, releaseVersion: 'fixture', releaseGitSha: 'a'.repeat(40) }), []);
  for (const change of [
    value => { value.executionMode = 'simulated'; },
    value => { value.dryRun = true; },
    value => { value.checks[0].exitCode = 1; },
    value => { value.checks.splice(0, 1); },
    value => { value.releaseVersion = 'other'; },
    value => { delete value.observedSourceCommit; },
    value => { value.observedSourceCommit = 'b'.repeat(40); }
  ]) {
    const negative = structuredClone(positive); change(negative);
    assert.ok(qualifyReleaseReport(negative, { root, role, releaseVersion: 'fixture', releaseGitSha: 'a'.repeat(40) }).length > 0);
  }
}
assert.ok(qualifyReleaseReport(report('prepare'), { root, role: 'runtime' }).some(error => error.includes('missing passed runtime')));
assert.ok(qualifyReleaseReport(report('prepare'), { root, role: 'nodeVerify' }).some(error => error.includes('missing passed nodeVerify')));
console.log('Release evidence is qualified against consumer-owned role inventories.');
