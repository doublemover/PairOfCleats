import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { partitionCorrectness, validatePartition, validateCaseReport, planDigest, plannedRuntimeSkips } from '../../../tools/ci/suite-cohorts.js';
import { validateCohortPlan } from '../../../tools/ci/cohort-plan.js';
import { verifyCohortReceipt } from '../../../tools/ci/aggregate-cohorts.js';
import { buildCoverageRanges, mergeCoverageRanges } from '../../../tools/testing/coverage/ranges.js';
import { selectTestIds } from '../../runner/test-id-selection.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const groups = partitionCorrectness(ids, { a: 12000, c: 6000, f: 4000, g: 2000, h: 2000 });
assert.deepEqual(groups, partitionCorrectness(ids, { h: 2000, a: 12000, g: 2000, c: 6000, f: 4000 }));
validatePartition(ids, groups);
for (const group of groups) assert.deepEqual(group.ids, ids.filter(id => group.ids.includes(id)));
assert.throws(() => validatePartition(ids, groups.slice(1)), /omit/);
assert.throws(() => validatePartition(ids, [...groups, groups[0]]), /duplicate/);
const plan = { schemaVersion: 1, source: 'a'.repeat(40), platform: process.platform,
  runtime: { node: process.version, abi: process.versions.modules, arch: process.arch },
  groups: groups.map(group => ({ ...group, cohort: 'correctness', labels: ['CI test lane'] })),
  stepCases: { 'CI test lane': ids }, presetSkips: {} };
plan.digest = planDigest(plan); validateCohortPlan(plan);
const changed = structuredClone(plan); changed.groups.pop(); changed.digest = planDigest(changed);
assert.throws(() => validateCohortPlan(changed), /incomplete/);
assert.throws(() => validateCohortPlan({ ...plan, source: 'b'.repeat(40) }), /identity/);
const report = { summary: { passed: 2, failed: 0, skipped: 0, total: 2 }, tests: ['a', 'b'].map(id => ({
  id, status: 'passed', exitCode: 0, durationMs: 10, timedOut: false, attempts: 1 })) };
validateCaseReport(['a', 'b'], report);
for (const [key, value] of [['status', 'failed'], ['timedOut', true], ['durationMs', 30001], ['attempts', 2], ['exitCode', 1]]) {
  const bad = structuredClone(report); bad.tests[0][key] = value;
  assert.throws(() => validateCaseReport(['a', 'b'], bad), /qualify/);
}
assert.throws(() => validateCaseReport(['a', 'b', 'missing'], report), /omits/);
assert.throws(() => validateCaseReport(['a', 'b'], { ...report, summary: { ...report.summary, passed: 3 } }), /summary/);
const skipped = structuredClone(report); Object.assign(skipped.tests[0], { status: 'skipped', exitCode: null, attempts: 0, skipReason: 'excluded tag: destructive' });
Object.assign(skipped.summary, { passed: 1, skipped: 1 });
assert.throws(() => validateCaseReport(['a', 'b'], skipped), /qualify/);
validateCaseReport(['a', 'b'], skipped, { a: 'excluded tag: destructive' });
const knownSkips = plannedRuntimeSkips('win32', ['smoke/tantivy', 'cli/general/signal-cleanup', 'unrelated']);
assert.deepEqual(Object.keys(knownSkips), ['smoke/tantivy', 'cli/general/signal-cleanup']);
assert.ok(knownSkips['cli/general/signal-cleanup'].owner.includes('native-inspection'));
assert.equal(Object.keys(plannedRuntimeSkips('linux', ['cli/general/signal-cleanup'])).length, 0);
assert.equal(Object.keys(plannedRuntimeSkips('darwin', ['tooling/index/clean-artifacts-multi-repository/windows-locked-reader'])).length, 1);
const optional = structuredClone(skipped);
Object.assign(optional.tests[0], { id: 'smoke/tantivy', attempts: 1, exitCode: 77, skipReason: knownSkips['smoke/tantivy'].reason });
validateCaseReport(['smoke/tantivy', 'b'], optional, {}, knownSkips);
for (const patch of [{ skipReason: 'unexpected missing dependency' }, { attempts: 0 }, { exitCode: 0 }]) {
  const invalid = structuredClone(optional); Object.assign(invalid.tests[0], patch);
  assert.throws(() => validateCaseReport(['smoke/tantivy', 'b'], invalid, {}, knownSkips), /qualify/);
}
const foreignSkips = { ...plan, runtimeSkips: knownSkips }; foreignSkips.digest = planDigest(foreignSkips);
assert.throws(() => validateCohortPlan(foreignSkips), /exclusions/);
const group = { key: 'compiler', cohort: 'compiler', labels: ['contracts'], ids: ['a', 'b'] };
const target = { ...plan, stepCases: { contracts: ['a', 'b'] } };
const bytes = Buffer.from(JSON.stringify(report)), sha256 = createHash('sha256').update(bytes).digest('hex');
const receipt = { schemaVersion: 1, source: plan.source, planDigest: plan.digest, platform: plan.platform,
  runtime: plan.runtime,
  startedAt: 1000, finishedAt: 1010,
  key: 'compiler', ok: true, completed: ['contracts'], reports: [{ label: 'contracts', sha256 }] };
const reports = new Map([['contracts', { bytes, document: report }]]);
verifyCohortReceipt({ plan: target, group, receipt, reports });
for (const patch of [{ ok: false }, { source: 'b'.repeat(40) }, { completed: [] }, { key: 'api' }, { planDigest: 'foreign' }])
  assert.throws(() => verifyCohortReceipt({ plan: target, group, receipt: { ...receipt, ...patch }, reports }), /Incomplete/);
assert.throws(() => verifyCohortReceipt({ plan: target, group, receipt, reports: new Map() }), /Missing/);
assert.throws(() => verifyCohortReceipt({ plan: target, group, receipt, reports: new Map([['contracts', { bytes: Buffer.from('changed'), document: report }]]) }), /changed/);
const gateBytes = Buffer.from('{"ok":true}');
const gateGroup = { key: 'usr', cohort: 'usr', labels: ['gate'], ids: [] };
const gatePlan = { ...target, stepCases: { gate: [] } };
const gateReceipt = { ...receipt, key: 'usr', completed: ['gate'], reports: [],
  outputs: [{ label: 'gate', files: [{ file: '.diagnostics/usr/gate.json', sha256: createHash('sha256').update(gateBytes).digest('hex') }] }] };
verifyCohortReceipt({ plan: gatePlan, group: gateGroup, receipt: gateReceipt, reports: new Map(), outputs: new Map([['gate', [gateBytes]]]) });
assert.throws(() => verifyCohortReceipt({ plan: gatePlan, group: gateGroup, receipt: gateReceipt, reports: new Map() }), /Missing/);
const one = buildCoverageRanges(new Map([['src/one.js', new Map([['0:10', false], ['2:8', true]])]]));
const two = buildCoverageRanges(new Map([['src/one.js', new Map([['0:10', true], ['2:8', false]])]]));
assert.deepEqual(mergeCoverageRanges([one, two]), [{ path: 'src/one.js', totalRanges: 2, coveredRanges: 2 }],
  'coverage unions original ranges, rather than adding shard denominators');
assert.throws(() => mergeCoverageRanges([{ ...one, sourcePlatform: process.platform === 'win32' ? 'linux' : 'win32' }]), /platform/);
assert.throws(() => mergeCoverageRanges([{ ...one, entries: [{ path: '../outside', ranges: [] }] }]), /source/);
const selection = ['b', 'a', 'c'].map(id => ({ id }));
assert.deepEqual(selectTestIds(selection, ['a', 'b']).map(test => test.id), ['b', 'a']);
for (const invalid of [[], ['a', 'a'], ['unknown'], [null]]) assert.throws(() => selectTestIds(selection, invalid));
console.log('Cohorts retain original selections and exact coverage; foreign, missing, retried and over-budget evidence fails.');
