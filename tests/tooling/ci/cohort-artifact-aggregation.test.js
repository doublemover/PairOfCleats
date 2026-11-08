import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { aggregatePlatformCohorts } from '../../../tools/ci/aggregate-cohorts.js';
import { buildCoverageArtifact } from '../../../tools/testing/coverage/index.js';
import { buildCoverageRanges, mergeCoverageRanges } from '../../../tools/testing/coverage/ranges.js';

// Simulated artifact inputs exercise the actual filesystem aggregator. They are
// unit evidence for acceptance controls, never hosted qualification receipts.
const dir = await makeTempDir('cohort-artifact-aggregation-'), artifactsRoot = path.join(dir, 'artifacts');
const plan = { source: 'a'.repeat(40), digest: 'b'.repeat(64), platform: process.platform,
  runtime: { node: process.version, abi: process.versions.modules, arch: process.arch },
  groups: Array.from({ length: 4 }, (_, i) => ({ key: `correctness-${i + 1}`, cohort: 'correctness',
    labels: ['CI test lane'], ids: [`test-${i}`] })),
  stepCases: { 'CI test lane': ['test-0', 'test-1', 'test-2', 'test-3'] }, presetSkips: {} };
const write = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value); };
const digest = value => createHash('sha256').update(value).digest('hex');
try {
  for (const [i, group] of plan.groups.entries()) {
    const root = path.join(artifactsRoot, `ci-windows-${group.key}`), diagnostic = path.join(root, '.diagnostics');
    const report = JSON.stringify({ summary: { passed: 1, failed: 0, skipped: 0, total: 1, durationMs: 10 },
      tests: [{ id: group.ids[0], path: 'simulated.test.js', lane: 'ci-lite', status: 'passed', exitCode: 0, timedOut: false, attempts: 1, durationMs: 10 }] });
    const ranges = buildCoverageRanges(new Map([['src/example.js', new Map([['0:10', i % 2 === 0], ['2:8', i % 2 === 1]])]]));
    const coverage = buildCoverageArtifact({ runId: group.key, entries: mergeCoverageRanges([ranges]) });
    const summaryBytes = JSON.stringify(coverage), rangeBytes = JSON.stringify(ranges);
    await write(path.join(diagnostic, 'test-summary.json'), report);
    await write(path.join(diagnostic, 'coverage/test-coverage-ci.json'), summaryBytes);
    await write(path.join(diagnostic, 'coverage/test-coverage-ci.json.ranges.json'), rangeBytes);
    await write(path.join(root, '.testLogs/junit.xml'), `<testsuite name="${group.key}"><testcase name="${group.ids[0]}"/></testsuite>`);
    await write(path.join(diagnostic, 'cohort-result.json'), JSON.stringify({ schemaVersion: 1,
      source: plan.source, planDigest: plan.digest, platform: plan.platform, runtime: plan.runtime,
      key: group.key, ok: true, completed: group.labels,
      startedAt: 1000 + i, finishedAt: 1010 + i,
      reports: [{ label: 'CI test lane', file: '.diagnostics/test-summary.json', sha256: digest(report) }],
      coverage: { summary: digest(summaryBytes), ranges: digest(rangeBytes) } }));
  }
  const compiler = { key: 'compiler', cohort: 'compiler', labels: ['contracts'], ids: ['compiler-case'] };
  plan.groups.push(compiler); plan.stepCases.contracts = compiler.ids;
  const compilerRoot = path.join(artifactsRoot, 'ci-windows-compiler/.diagnostics');
  const compilerReport = JSON.stringify({ summary: { total: 1, passed: 1, failed: 0, skipped: 0 },
    tests: [{ id: 'compiler-case', status: 'passed', durationMs: 1, timedOut: false, exitCode: 0, attempts: 1 }] });
  await write(path.join(compilerRoot, 'serial-compiler-api-contracts.json'), compilerReport);
  await write(path.join(compilerRoot, 'native-verify.log'), 'original cohort setup');
  await write(path.join(compilerRoot, 'cohort-result.json'), JSON.stringify({ schemaVersion: 1,
    source: plan.source, planDigest: plan.digest, platform: plan.platform, runtime: plan.runtime,
    key: compiler.key, ok: true, completed: compiler.labels,
    startedAt: 1000, finishedAt: 1010,
    reports: [{ label: 'contracts', file: '.diagnostics/serial-compiler-api-contracts.json', sha256: digest(compilerReport) }] }));
  const root = path.join(dir, 'valid');
  await write(path.join(root, '.diagnostics/native-verify.log'), 'aggregate setup');
  const valid = await aggregatePlatformCohorts({ root, artifactsRoot, plan, platformName: 'windows' });
  assert.equal(valid.ok, true, JSON.stringify(valid)); assert.equal(valid.correctnessComplete, true);
  const coverage = JSON.parse(await fs.readFile(path.join(root, '.diagnostics/coverage/test-coverage-ci.json')));
  assert.deepEqual(coverage.entries, [{ path: 'src/example.js', coveredRanges: 2, totalRanges: 2 }]);
  const summary = JSON.parse(await fs.readFile(path.join(root, '.diagnostics/test-summary.json')));
  assert.equal(summary.tests.length, 4); assert.equal(summary.summary.passed, 4);
  assert.equal(await fs.readFile(path.join(root, '.diagnostics/native-verify.log'), 'utf8'), 'aggregate setup');
  assert.equal(await fs.readFile(path.join(root, '.diagnostics/cohorts/compiler/native-verify.log'), 'utf8'), 'original cohort setup');
  await fs.access(path.join(root, '.diagnostics/serial-compiler-api-contracts.json'));
  assert.equal((await fs.readFile(path.join(root, '.testLogs/junit.xml'), 'utf8')).match(/<testsuite\s/g).length, 4);
  const selected = path.join(artifactsRoot, 'ci-windows-correctness-1/.diagnostics/cohort-result.json');
  const receipt = JSON.parse(await fs.readFile(selected)); receipt.source = 'c'.repeat(40); await fs.writeFile(selected, JSON.stringify(receipt));
  const invalidRoot = path.join(dir, 'foreign');
  const foreign = await aggregatePlatformCohorts({ root: invalidRoot, artifactsRoot, plan, platformName: 'windows' });
  assert.equal(foreign.ok, false); assert.equal(foreign.correctnessComplete, false);
  assert.ok(foreign.errors.some(error => error.includes('foreign')));
  await fs.access(path.join(invalidRoot, '.diagnostics/cohorts/correctness-1/cohort-result.json'));
  await assert.rejects(fs.access(path.join(invalidRoot, '.diagnostics/coverage/test-coverage-ci.json')), { code: 'ENOENT' });
} finally { await rmDirRecursive(dir); }
console.log('Actual artifact aggregation preserves range unions, JUnit and failures; foreign cohorts cannot qualify.');
