import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureSearchShowcaseCase, buildSearchShowcaseReviewReport } from '../../../tools/testing/run-search-showcase.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd(), { dir: logsRoot } = await prepareTestCacheDir('search-showcase-machine-stdout');
const entrypoint = path.join(root, 'tests/fixtures/search-showcase-machine-output/command.js'), runs = [];
for (const [mode, pollution, expectedExitCode] of [['clean', 0, 0], ['diagnostic', 0, 0], ['trailing', 1, 0], ['empty', 1, 1], ['negative', 0, 3], ['human', 0, 0]]) {
  const entry = { id: mode, category: mode === 'human' ? 'human' : 'machine' };
  const { meta, review } = await captureSearchShowcaseCase({ entry, entrypoint, commandArgs: [mode],
    captureOptions: { rootDir: root, cwd: root, logsRoot, label: mode, env: applyTestEnv({ syncProcess: false }) } });
  assert.equal(meta.mode, 'pipe'); assert.equal(meta.exitCode, expectedExitCode);
  assert.equal(review.diagnosticPollution, pollution);
  assert.equal(meta.stdout.jsonParsingRequested, mode !== 'human');
  assert.equal(review.machineStdout.state, mode === 'human' ? 'not-applicable' : pollution ? 'failed' : 'passed');
  const raw = await fs.readFile(review.machineStdout.rawStdoutPath, 'utf8');
  if (mode === 'trailing') { assert.match(raw, /warning on stdout/); assert.ok(meta.stdout.jsonParseError); assert.equal(meta.stderr.bytes, 0); }
  if (mode === 'diagnostic') { assert.ok(meta.stdout.parsedAsJson); assert.ok(meta.stderr.bytes > 0); assert.doesNotMatch(raw, /diagnostic/); }
  if (mode === 'empty') { assert.equal(raw, ''); assert.equal(meta.stdout.jsonParseError, 'empty_stdout'); }
  runs.push({ id: mode, status: 'ok', captureMode: meta.mode, outputDir: meta.outputDir, terminalSize: { id: '80x24', columns: 80 }, review });
}
const report = buildSearchShowcaseReviewReport({ suiteDir: logsRoot, runs });
assert.equal(report.diagnosticPollutionCount, 2); assert.equal(report.machineOutputFailureCount, 2);
const trailing = report.worstRuns.find(run => run.id === 'trailing');
assert.equal(trailing.captureMode, 'pipe'); assert.equal(trailing.terminalSize, '80x24');
assert.ok(trailing.machineStdout.jsonParseError); assert.ok(trailing.machineStdout.rawStdoutPath);
assert.ok(trailing.score > report.worstRuns.find(run => run.id === 'diagnostic').score);
console.log('Machine showcase QA validates raw stdout JSON independently of expected stderr and process exit status.');
