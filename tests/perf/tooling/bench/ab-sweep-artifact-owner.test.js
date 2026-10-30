import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runAbSweep, buildSweepMatrix, AB_SWEEP_MAX_VARIANTS } from '../../../../tools/bench/ab-sweep.js';
import { createSweepArtifacts, readSweepVariantReport } from '../../../../tools/bench/ab-sweep-artifacts.js';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { prepareTestCacheDir } from '../../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });
const root = process.cwd(), { dir } = await prepareTestCacheDir('ab-sweep-artifact-owner');
const argv = { scripts: path.join(root, 'tests', 'fixtures', 'ab-sweep', 'knob-aware.js'),
  suite: null, timeoutMs: 3000, repoRoot: null, indexDir: null, json: null, knobs: {} };
const arrived = [];
let release;
const bothChildrenPublished = new Promise(resolve => { release = resolve; });
let timer;
const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Both independent sweep children must publish within 8 seconds.')), 8000); });
const afterChild = async receipt => {
  arrived.push({ ...receipt, bytes: await fs.readFile(receipt.outPath) });
  if (arrived.length === 2) release();
  await Promise.race([bothChildrenPublished, deadline]);
};
let a, b;
try {
  [a, b] = await Promise.all([runAbSweep({ argv, root: dir, afterChild }), runAbSweep({ argv, root: dir, afterChild })]);
} finally { clearTimeout(timer); }
assert.notEqual(a.report.experimentId, b.report.experimentId);
assert.equal(arrived.length, 2);
for (const result of [a, b]) {
  const row = result.report.runs[0];
  const own = arrived.find(value => value.experiment.experimentId === result.report.experimentId);
  assert.equal(row.reportPath, own.outPath);
  assert.equal(row.reportReceipt.sha256, 'sha256:' + createHash('sha256').update(own.bytes).digest('hex'));
  assert.equal(row.results[0].status, 'ok');
  assert.deepEqual(await fs.readFile(row.reportPath), own.bytes);
  const final = JSON.parse(await fs.readFile(result.report.finalReceiptPath, 'utf8'));
  assert.equal(final.experimentId, result.report.experimentId);
}
assert.notEqual(a.report.runs[0].reportPath, b.report.runs[0].reportPath);
const c = await runAbSweep({ argv, root: dir });
assert.notEqual(c.report.experimentId, a.report.experimentId);
for (const own of arrived) assert.deepEqual(await fs.readFile(own.outPath), own.bytes, 'later runs cannot overwrite earlier evidence');

const artifacts = await createSweepArtifacts(dir, { workloadFingerprint: 'test-only', matrixFingerprint: 'test-only' });
const malformed = path.join(artifacts.runDir, 'malformed.json');
await fs.writeFile(malformed, '{');
assert.equal(readSweepVariantReport(artifacts.runDir, malformed, 65536).reportError, 'malformed-report');
assert.equal(readSweepVariantReport(artifacts.runDir, path.join(artifacts.runDir, 'absent.json'), 65536).reportError, 'missing-report');
const invalidUtf8 = path.join(artifacts.runDir, 'invalid-utf8.json');
await fs.writeFile(invalidUtf8, Buffer.from([0xff]));
assert.equal(readSweepVariantReport(artifacts.runDir, invalidUtf8, 65536).reportError, 'malformed-report');
const foreign = readSweepVariantReport(artifacts.runDir, a.report.runs[0].reportPath, 65536);
assert.equal(foreign.report, null, 'outside reports cannot enter another owner by pathname');
assert.equal(foreign.reportError, 'unreadable-or-oversized-report');
await assert.rejects(artifacts.finish({ experimentId: 'foreign', finalReceiptPath: artifacts.finalPath }), /another invocation/u);
await artifacts.finish({ experimentId: artifacts.experimentId, finalReceiptPath: artifacts.finalPath, outcome: 'fixture' });
await assert.rejects(artifacts.finish({ experimentId: artifacts.experimentId, finalReceiptPath: artifacts.finalPath }), /immutable/u);
assert.equal(buildSweepMatrix({ cpuTokens: [1, 1], workerCounts: [1] }).length, 1, 'duplicate requests do not repeat identical variants');
assert.throws(() => buildSweepMatrix({ cpuTokens: Array.from({ length: AB_SWEEP_MAX_VARIANTS + 1 }, (_, i) => i + 1) }),
  error => error.code === 'ERR_AB_SWEEP_MATRIX_LIMIT');

const abort = new AbortController(); abort.abort(new Error('fixture cancellation before launch'));
const cancelled = await runAbSweep({ argv: { ...argv, knobs: { cpuTokens: [2, 3] } }, root: dir, signal: abort.signal });
assert.equal(cancelled.exitCode, 1); assert.equal(cancelled.report.recommendation, null);
assert.equal(cancelled.report.outcome, 'cancelled');
assert.equal(cancelled.report.runs.length, 2);
assert.ok(cancelled.report.runs.every(run => run.notRunReason === 'cancelled'));
assert.equal(JSON.parse(await fs.readFile(cancelled.report.finalReceiptPath, 'utf8')).outcome, 'cancelled');
console.log('A/B invocation artifact ownership test passed');
