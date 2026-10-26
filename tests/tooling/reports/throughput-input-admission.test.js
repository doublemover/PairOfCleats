import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createThroughputInputSession } from '../../../tools/reports/show-throughput/result-input.js';
import { classifyThroughputInput, admitThroughputReport, admitThroughputBaselineChild, THROUGHPUT_REPORT_VERSION } from '../../../tools/reports/show-throughput/result-contract.js';
import { BENCH_MEASUREMENT_SNAPSHOT_VERSION } from '../../../tools/bench/language/metrics/recorded-contract.js';
import { BENCH_TERMINAL_RECEIPT_VERSION } from '../../../tools/bench/runner-contract.js';
import { spawnSubprocessSync } from '../../../src/shared/subprocess/runner.js';
import { createShowThroughputPayload } from './show-throughput-report-fixture.js';
import { prepareTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const env = applyTestEnv({ syncProcess: false }), { dir } = await prepareTestCacheDir('throughput-input-admission');
const root = process.cwd(), results = path.join(dir, 'results'), folder = path.join(results, 'javascript');
await fs.mkdir(folder, { recursive: true });
const good = createShowThroughputPayload({ repoRoot: 'C:/fixture/valid', chunksPerSec: 20 });
const inputs = new Map([
  ['healthy.json', JSON.stringify(good)], ['truncated.json', '{'],
  ['unrelated.json', JSON.stringify({ generatedAt: '2099-01-01T00:00:00Z', note: 'non-run-secret-witness' })],
  ['array.json', '[]'], ['string.json', '"not a run"'],
  ['legacy.json', JSON.stringify({ generatedAt: '2020-01-01T00:00:00Z', summary: { queries: 0 } })],
  ['failed.json', JSON.stringify({ generatedAt: '2020-01-01T00:00:01Z', repo: { root: 'C:/fixture/failed' }, summary: null, runs: [], status: 'failed' })],
  ['manifest.json', JSON.stringify({ kind: 'bench-terminal', schemaVersion: BENCH_TERMINAL_RECEIPT_VERSION, status: 'skipped', benchmark: 'fixture', reason: 'optional-unavailable' })],
  ['future.json', JSON.stringify({ schemaVersion: 999, repo: { root: 'C:/fixture/future' }, summary: null, runs: [] })]
]);
for (const [file, value] of inputs) await fs.writeFile(path.join(folder, file), value);
const collect = async (session, directory, options) => {
  const selected = [];
  for await (const row of session.folder(directory, options)) { selected.push(row.file); session.processed(row.path); }
  return selected;
};
let session = createThroughputInputSession();
try {
  assert.deepEqual(await collect(session, folder, { latestCount: 1 }), ['healthy.json'], 'unrelated later JSON cannot displace a run');
  const receipt = session.snapshot();
  assert.equal(receipt.discovered, 9); assert.equal(receipt.selected, 1);
  assert.equal(receipt.admitted, 1); assert.equal(receipt.processed, 1);
  assert.equal(receipt.failures, 5); assert.equal(receipt.complete, false); assert.equal(receipt.state, 'partial');
  assert.ok(receipt.folders[0].files.some(row => row.state === 'unsupported-version'));
  assert.ok(receipt.folders[0].files.some(row => row.state === 'recognized-non-run'));
  assert.ok(receipt.folders[0].files.every(row => !Object.hasOwn(row, 'payload') && !Object.hasOwn(row.source || {}, 'fileIdentity')));
} finally { session.close(); }
for (const value of [null, [], 'text', { generatedAt: '2099-01-01T00:00:00Z' }, { summary: { buildMs: { note: 'not timing' } } },
  { summary: { topN: 10 } },
  { repo: { root: '/fixture' }, runs: [1], summary: {} },
  { repo: { root: '/fixture' }, runs: { some: 5 }, summary: null },
  { repo: { root: '/fixture' }, runs: [], summary: 'wrong type' },
  { repo: { root: '/fixture' }, runs: [], summary: {} }, { artifacts: { throughput: {} } }, { artifacts: { scanProfile: { schemaVersion: 1, modes: {} } } }]) {
  assert.equal(classifyThroughputInput(value), 'unsupported-envelope');
}
assert.equal(classifyThroughputInput({ repo: { root: '/fixture' }, runs: [], summary: null }), 'supported-run');
assert.equal(classifyThroughputInput({ repo: { root: '/fixture' }, runs: [{ status: 'failed', error: 'fixture failure' }], summary: null }), 'supported-run');
assert.equal(classifyThroughputInput({ schemaVersion: BENCH_MEASUREMENT_SNAPSHOT_VERSION, attemptId: 'fixture-attempt', metricsByMode: {} }), 'recognized-non-run');

const reportScript = path.join(root, 'tools/reports/show-throughput.js');
const cli = runNode([reportScript, '--root', results, '--profile', 'raw', '--json', '--latest', '1'], 'partial throughput input receipt', root, env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000, spawnOptions: { maxBuffer: 2 * 1024 * 1024 } });
assert.equal(cli.status, 1, cli.stderr);
const output = JSON.parse(cli.stdout);
assert.equal(output.schemaVersion, THROUGHPUT_REPORT_VERSION); assert.equal(output.inputAdmission.complete, false);
assert.equal(output.inputAdmission.failures, 5);
assert.equal(output.folders.length, 1, 'healthy observations remain available in a partial report');
assert.equal(String(cli.stdout).includes('non-run-secret-witness'), false);
for (const [file, original] of inputs) assert.equal(await fs.readFile(path.join(folder, file), 'utf8'), original, 'inspection never materializes');
assert.equal(admitThroughputReport(output).ok, false);
const child = value => spawnSubprocessSync(process.execPath, ['-e', 'process.stdout.write(process.argv[1]);', JSON.stringify(value)],
  { timeoutMs: 3000, maxOutputBytes: 2 * 1024 * 1024 });
assert.equal(admitThroughputBaselineChild(child({ folders: [] })).reason, 'unsupported-report-envelope');
assert.equal(admitThroughputBaselineChild(child(output)).ok, false, 'zero exit cannot promote partial input');

const emptyRoot = path.join(dir, 'empty'); await fs.mkdir(emptyRoot);
const emptyCli = runNode([reportScript, '--root', emptyRoot, '--profile', 'raw', '--json'], 'explicit empty throughput receipt', root, env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
assert.equal(emptyCli.status, 0, emptyCli.stderr);
const empty = JSON.parse(emptyCli.stdout);
assert.equal(empty.inputAdmission.state, 'empty'); assert.equal(admitThroughputReport(empty).empty, true);

const changing = path.join(dir, 'changing'); await fs.mkdir(changing);
await fs.writeFile(path.join(changing, 'removed.json'), JSON.stringify(good));
await fs.writeFile(path.join(changing, 'changed.json'), JSON.stringify(good));
session = createThroughputInputSession();
try {
  assert.deepEqual(await collect(session, changing, { afterInventory: async () => {
    await fs.rm(path.join(changing, 'removed.json'));
    await fs.writeFile(path.join(changing, 'changed.json'), JSON.stringify({ ...good, generatedAt: '2099-01-01T00:00:00Z' }));
  } }), []);
  assert.equal(session.snapshot().failures, 2);
  assert.deepEqual(new Set(session.snapshot().folders[0].files.map(file => file.state)), new Set(['missing', 'changed-or-unreadable']));
} finally { session.close(); }

const many = path.join(dir, 'many'); await fs.mkdir(many);
for (let i = 0; i < 40; i++) await fs.writeFile(path.join(many, `run-${String(i).padStart(3, '0')}.json`), JSON.stringify({ ...good,
  generatedAt: new Date(Date.UTC(2026, 9, 26, 0, 0, i)).toISOString() }));
await fs.writeFile(path.join(many, 'oversized.json'), 'x'.repeat(10000));
session = createThroughputInputSession({ limits: { fileBytes: 8192, retainedBytes: 4096, readBytes: 256 * 1024, metadataBytes: 256 * 1024 } });
try {
  assert.deepEqual(await collect(session, many, { latestCount: 2 }), ['run-038.json', 'run-039.json']);
  const receipt = session.snapshot();
  assert.equal(receipt.selected, 2); assert.equal(receipt.processed, 2);
  assert.equal(receipt.folders[0].files.find(file => file.file === 'oversized.json').state, 'too-large');
  assert.ok(receipt.budget.retainedPayloadBytes < 4096);
  assert.ok(receipt.budget.readAllowanceConsumed <= receipt.budget.limits.readBytes);
  assert.ok(receipt.budget.retainedMetadataBytes <= receipt.budget.limits.metadataBytes);
} finally { session.close(); }
for (const limits of [{ files: 1 }, { metadataBytes: 1 }, { readBytes: 1 }, { retainedBytes: 1 }]) {
  session = createThroughputInputSession({ limits });
  try {
    await collect(session, many, { latestCount: 2 });
    const receipt = session.snapshot();
    assert.equal(receipt.complete, false, JSON.stringify(limits));
    assert.equal(receipt.state, 'partial');
    assert.ok(receipt.budget.readAllowanceConsumed <= receipt.budget.limits.readBytes);
    assert.ok(receipt.budget.retainedPayloadBytes <= receipt.budget.limits.retainedBytes);
    assert.ok(receipt.budget.retainedMetadataBytes <= receipt.budget.limits.metadataBytes);
  } finally { session.close(); }
}
const abort = new AbortController(); abort.abort(); session = createThroughputInputSession({ signal: abort.signal });
try { assert.deepEqual(await collect(session, folder), []); assert.equal(session.snapshot().cancelled, true); assert.equal(session.snapshot().state, 'partial'); }
finally { session.close(); }

const materialize = runNode([path.join(root, 'tools/reports/materialize-throughput.js'), '--root', results], 'materialization input admission', root, env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
assert.equal(materialize.status, 1);
assert.match(materialize.stderr, /Input admission: partial/u);
for (const file of ['truncated.json', 'unrelated.json', 'array.json', 'string.json', 'future.json', 'manifest.json']) {
  assert.equal(await fs.readFile(path.join(folder, file), 'utf8'), inputs.get(file), 'rejected/non-run inputs cannot be materialized');
}
console.log('bounded throughput result admission test passed');
