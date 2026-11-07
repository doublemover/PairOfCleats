import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { runShowThroughputReport } from './show-throughput-report-fixture.js';
import { THROUGHPUT_REPORT_VERSION } from '../../../tools/reports/show-throughput/result-contract.js';

const { dir } = await prepareIsolatedTestCacheDir('throughput-focused-mode-consumer');
const currentRoot = path.join(dir, 'current'), baselineRoot = path.join(dir, 'baseline'), originals = new Map();
const write = async (root, folder, name, { code, prose, date, repo = 'target', build = 1000 }) => {
  const metrics = rate => ({ files: 1, chunks: rate, tokens: rate * 2, bytes: rate * 4,
    totalMs: 1000, filesPerSec: 1, chunksPerSec: rate, tokensPerSec: rate * 2, bytesPerSec: rate * 4 });
  const value = { ...(date ? { generatedAt: date } : {}), repo: { root: path.join(dir, repo) },
    summary: { queries: 1, buildMs: { index: build }, queryWallMsPerQuery: 10, queryWallMsPerSearch: 20 },
    artifacts: { throughput: { code: metrics(code), prose: metrics(prose), extractedProse: metrics(prose * 2) },
      indexing: { schemaVersion: 1, modes: { code: { lines: 10, files: 1, totalMs: 1000, durationMs: 1000 },
        prose: { lines: 200, files: 1, totalMs: 1000, durationMs: 1000 },
        'extracted-prose': { lines: 300, files: 1, totalMs: 1000, durationMs: 1000 } } } } };
  const file = path.join(root, folder, name + '.json'); await fs.mkdir(path.dirname(file), { recursive: true });
  const bytes = JSON.stringify(value); await fs.writeFile(file, bytes); originals.set(file, bytes);
};
for (const root of [currentRoot, baselineRoot]) for (const [folder, code, prose] of [
  ['a-stable-prose', [10, 30], [40, 40]], ['z-noisy-prose', [10, 10], [20, 100]]
]) {
  await write(root, folder, 'z-old', { code: code[0], prose: prose[0], date: '2026-10-20T00:00:00Z', build: folder.startsWith('z') ? 1000 : 10 });
  await write(root, folder, 'a-new', { code: code[1], prose: prose[1], date: '2026-10-21T00:00:00Z', build: folder.startsWith('z') ? 1000 : 10 });
  await write(root, folder, 'unrelated-newest', { code: 9999, prose: 9999, date: '2026-10-22T00:00:00Z', repo: 'other' });
}
const run = (args, { failure = false } = {}) => {
  const result = runShowThroughputReport(['--root', currentRoot, '--repo', 'target', ...args], { allowFailure: true });
  assert.equal(result.status === 0, !failure, result.stderr || result.stdout); return result;
};
const json = args => JSON.parse(run([...args, '--json']).stdout);
const text = args => String(run(args).stdout).replace(/\u001b\[[0-9;]*m/g, '');
const csv = args => String(run([...args, '--csv']).stdout).trim().split(/\r?\n/);
for (const mode of ['code', 'prose', 'extractedProse']) {
  const canonical = mode === 'extractedProse' ? 'extracted-prose' : mode;
  const args = ['--profile', 'family', '--mode', mode, '--sort', 'variability', '--top', '1'];
  const report = json(args), expected = mode === 'code' ? 'a-stable-prose' : 'z-noisy-prose';
  assert.equal(report.schemaVersion, THROUGHPUT_REPORT_VERSION);
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].folder, expected);
  assert.equal(report.rows[0].metricScopes.linesPerSec, canonical);
  assert.ok(text(args).includes(expected));
  const rows = csv(args); assert.equal(rows.length, 2); assert.ok(rows[1].startsWith(expected + ','));
  if (mode !== 'code') {
    assert.ok(Math.abs(report.rows[0].variability - 2 / 3) < 1e-12);
    assert.equal(report.rows[0].linesPerSec, mode === 'prose' ? 200 : 300);
  } else assert.equal(report.rows[0].variability, 0.5);
  assert.equal(report.inputAdmission.selected, 4); assert.equal(report.inputAdmission.admitted, 4);
  assert.ok(report.folders.every(folder => folder.runCount === 2));
}
const latest = json(['--profile', 'family', '--mode', 'prose', '--latest', '1']);
assert.equal(latest.inputAdmission.selected, 2); assert.ok(latest.folders.every(folder => folder.runCount === 1));
assert.equal(latest.filters.latest, 1); assert.equal(latest.filters.repo, 'target');
for (const sort of ['chunks', 'build']) {
  const args = ['--profile', 'compare', '--compare', baselineRoot, '--mode', 'prose', '--sort', sort, '--top', '1'];
  const report = json(args); assert.equal(report.comparison.rows[0].folder, 'z-noisy-prose');
  assert.ok(text(args).includes('z-noisy-prose')); assert.ok(csv(args)[1].startsWith('z-noisy-prose,'));
}
run(['--profile', 'compare', '--compare', baselineRoot, '--sort', 'lines'], { failure: true });
run(['--profile', 'repo', '--sort', 'variability'], { failure: true });
run(['--mode', 'unsupported'], { failure: true });
for (const [file, original] of originals) assert.equal(await fs.readFile(file, 'utf8'), original, 'inspection cannot mutate its input evidence');
console.log('Actual throughput text/JSON/CSV consumers share admitted repo/latest populations, selected mode scope and numeric profile sorts.');
