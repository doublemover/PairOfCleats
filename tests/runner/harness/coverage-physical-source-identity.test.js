import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { normalizeCoverageSourcePath } from '../../../tools/testing/coverage/source-identity.js';
import { collectV8CoverageEntries, buildCoverageArtifact, mergeCoverageEntries, filterCoverageEntriesToChanged } from '../../../tools/testing/coverage/index.js';
import { buildCoveragePolicyReport, renderCoveragePolicyMarkdown } from '../../../tools/testing/coverage/policy.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['identity-adapter', 'physical-consumer'].includes(selected));
if (selected === 'identity-adapter') {
  for (const [input, expected] of [
    ['file:///repo/src/a%5Cb.js', 'src/a\\b.js'], ['file:///repo/src/a/b.js', 'src/a/b.js'],
    ['file:///repo/src/%20%C3%A9%23%3F.js', 'src/ é#?.js'],
    ['file:///repo/src/line%0Aname.js', 'src/line\nname.js'],
    ['file:///repo/src/tab%09name.js', 'src/tab\tname.js'],
    ['file:///repo/src/%20leading%20.js', 'src/ leading .js'],
    ['/repo/src/a\\b.js', 'src/a\\b.js'], ['/outside/a.js', null], ['node:fs', null]
  ]) assert.equal(normalizeCoverageSourcePath(input, '/repo', { platform: 'linux' }), expected);
  for (const [input, expected] of [
    ['file:///C:/repo/src/%C3%A9%20%23.js', 'src/é #.js'],
    [String.raw`C:\repo\src\a.js`, 'src/a.js'], ['file:///C:/repo/src/a%5Cb.js', null],
    [String.raw`\\host\share\repo\src\a.js`, 'src/a.js']
  ]) {
    const root = input.startsWith('\\\\') ? String.raw`\\host\share\repo` : String.raw`C:\repo`;
    assert.equal(normalizeCoverageSourcePath(input, root, { platform: 'win32' }), expected);
  }
  assert.throws(() => mergeCoverageEntries([{ entries: [{ path: 'src/a/b.js', coveredRanges: 1, totalRanges: 1 }] }]),
    { code: 'ERR_COVERAGE_SOURCE_IDENTITY' }, 'an old summary cannot reconstruct whether a source key was already aliased');
  const opposite = process.platform === 'win32' ? 'linux' : 'win32';
  assert.throws(() => mergeCoverageEntries([{ ...buildCoverageArtifact({ runId: 'other-platform', entries: [] }), sourcePlatform: opposite }]),
    { code: 'ERR_COVERAGE_SOURCE_IDENTITY' });
} else {
  const { dir } = await prepareIsolatedTestCacheDir('coverage-physical-source-identity');
  const repo = path.join(dir, 'repo'), coverageDir = path.join(dir, 'coverage');
  const literal = process.platform === 'win32' ? 'src/retrieval/literal.js' : 'src/retrieval/a\\b.js';
  const nested = 'src/retrieval/a/b.js';
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  try {
    await fs.mkdir(path.join(repo, 'src/retrieval/a'), { recursive: true }); await fs.mkdir(coverageDir);
    await fs.writeFile(path.join(repo, literal), 'export const value = 1;\n');
    await fs.writeFile(path.join(repo, nested), 'export const value = 1;\n');
    git(['init']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
    git(['add', '.']); git(['commit', '-m', 'physical identities']); const baseRef = git(['rev-parse', 'HEAD']);
    await fs.writeFile(path.join(repo, nested), 'export const value = 2;\n');
    const observed = (name, count) => ({ url: pathToFileURL(path.join(repo, name)).href,
      functions: [{ ranges: [{ startOffset: 0, endOffset: 22, count }] }] });
    const source = path.join(coverageDir, 'actual-v8-shape.json');
    await fs.writeFile(source, JSON.stringify({ result: [observed(literal, 1)] }));
    const entries = await collectV8CoverageEntries({ root: repo, coverageDir });
    assert.deepEqual(entries, [{ path: literal, coveredRanges: 1, totalRanges: 1 }]);
    const artifact = buildCoverageArtifact({ runId: 'physical-single', entries });
    const merged = mergeCoverageEntries([JSON.parse(JSON.stringify(artifact))]);
    assert.deepEqual(merged, entries);
    assert.deepEqual(filterCoverageEntriesToChanged({ root: repo, entries: merged }), [], 'unexecuted changed source cannot inherit a different physical source observation');
    git(['add', '.']); git(['commit', '-m', 'only nested source changed']); const headRef = git(['rev-parse', 'HEAD']);
    const report = buildCoveragePolicyReport({ root: repo, baseRef, headRef, coverageArtifact: artifact });
    assert.equal(report.changedFiles.inventory.find(row => row.path === nested).status, 'unobserved');
    assert.equal(report.changedFiles.measurement.status, 'partial');
    assert.equal(report.changedFiles.summary.coverageFraction, null);
    assert.match(renderCoveragePolicyMarkdown(report), /a\/b\.js/);
    await fs.writeFile(source, JSON.stringify({ result: [observed(literal, 1), observed(nested, 0)] }));
    const both = await collectV8CoverageEntries({ root: repo, coverageDir });
    assert.equal(both.length, 2); assert.equal(both.find(row => row.path === nested).coveredRanges, 0);
    assert.equal(both.find(row => row.path === literal).coveredRanges, 1);
    const twice = mergeCoverageEntries([buildCoverageArtifact({ runId: 'first', entries: both }), buildCoverageArtifact({ runId: 'second', entries: both })]);
    assert.equal(twice.find(row => row.path === nested).totalRanges, 2, 'summary merge remains additive rather than raw-range union');
    assert.equal(twice.find(row => row.path === nested).coveredRanges, 0);
    const zero = buildCoveragePolicyReport({ root: repo, baseRef, headRef, coverageArtifact: buildCoverageArtifact({ runId: 'both', entries: twice }) });
    assert.equal(zero.changedFiles.summary.coverageFraction, 0); assert.equal(zero.changedFiles.measurement.status, 'complete');
    assert.throws(() => buildCoveragePolicyReport({ root: repo, baseRef, headRef, coverageArtifact: { entries: both } }),
      { code: 'ERR_COVERAGE_SOURCE_IDENTITY' });
    console.log(JSON.stringify({ platform: process.platform, physicalLiteralBackslash: process.platform !== 'win32',
      portableAdapter: 'separate identity-adapter case', sources: both.map(row => row.path) }));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
}
console.log('Coverage keys preserve physical identity before raw OR aggregation, summary addition and changed-source qualification.');
