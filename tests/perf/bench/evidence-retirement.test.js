import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBenchmarkEvidenceRun } from '../../../tools/bench/evidence-store.js';
import { withBenchmarkEvidenceMaintenance, retireSettledBenchmarkEvidence } from '../../../tools/bench/evidence-retirement.js';
import { BENCH_EVIDENCE_SETTLED, BENCH_EVIDENCE_LOCK, BENCH_EVIDENCE_MIN_AGE_MS } from '../../../tools/bench/evidence-contract.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { errorGraphSome } from '../../helpers/error-graph.js';

// UNVALIDATED: small actual producer files, real reservation/lock owners and
// exact-file retirement. No benchmark child, model or corpus is executed.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['old', 'recent', 'pinned', 'final', 'active', 'unknown', 'changed', 'extra', 'nested',
  'changed-record', 'copied', 'shared-file', 'authority', 'quota', 'active-quota', 'changed-admission',
  'missing-admission', 'pending', 'replacement', 'handled-failure', 'closed', 'late-child'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'bench-evidence-'));
const familyRoot = path.join(root, 'evidence'), family = 'ab-sweep';
const started = Date.parse('2026-10-01T12:00:00Z');
let clock = started, settled = false, owner, failure;
const options = { root, familyRoot, family, requiredBytes: 512 * 1024, hardBytes: 4 * 1024 * 1024, now: () => clock };
const collect = async () => withBenchmarkEvidenceMaintenance(options, original =>
  retireSettledBenchmarkEvidence({ ...options, owner: original }));
const exists = async filename => { try { await fs.lstat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const code = expected => error => errorGraphSome(error, value => value?.code === expected);
try {
  owner = await createBenchmarkEvidenceRun(options);
  await owner.writeText('payload.json', '{"original":true}\n');
  const payload = path.join(owner.runDir, 'payload.json');
  if (selected === 'authority') {
    await assert.rejects(retireSettledBenchmarkEvidence({ ...options, owner: {} }), code('ERR_BENCH_EVIDENCE_AUTHORITY'));
    let expired;
    await withBenchmarkEvidenceMaintenance(options, async original => {
      expired = original;
      await assert.rejects(retireSettledBenchmarkEvidence({ ...options, owner: { ...original } }), code('ERR_BENCH_EVIDENCE_AUTHORITY'));
    });
    await assert.rejects(retireSettledBenchmarkEvidence({ ...options, owner: expired }), code('ERR_BENCH_EVIDENCE_AUTHORITY'));
  } else if (selected === 'quota' || selected === 'active-quota') {
    if (selected === 'quota') {
      await owner.finish();
      await fs.writeFile(path.join(familyRoot, 'unowned-capacity'), Buffer.alloc(3840 * 1024));
    }
    await assert.rejects(createBenchmarkEvidenceRun({ ...options,
      ...(selected === 'active-quota' ? { requiredBytes: 3840 * 1024 } : {}) }), code('ERR_STORAGE_ADMISSION'));
    assert.equal(await exists(payload), true, 'quota admission cannot retire active or unknown files');
  } else if (selected === 'changed-admission' || selected === 'missing-admission') {
    if (selected === 'missing-admission') await fs.unlink(payload);
    else await fs.writeFile(payload, '{"original":false}\n');
    await assert.rejects(owner.finish(), code('ERR_BENCH_EVIDENCE_REPORT_CHANGED'));
    assert.equal(owner.isSettled(), true, 'ordinary integrity failure still closes actual run resources');
    assert.equal(await exists(path.join(owner.runDir, BENCH_EVIDENCE_SETTLED)), false);
    clock += 2 * BENCH_EVIDENCE_MIN_AGE_MS;
    assert.equal((await collect()).retiredRuns, 0, 'unsealed failure grants no deletion authority');
  } else if (selected === 'pending' || selected === 'replacement') {
    const original = { cacheOwnershipReleased: () => settled };
    await assert.rejects(owner.finish(original), error => { failure = error; return error.benchmarkEvidenceOwner === owner; });
    assert.equal(await exists(path.join(owner.runDir, BENCH_EVIDENCE_LOCK)), true);
    if (selected === 'replacement') original.cacheOwnershipReleased = () => true;
    await assert.rejects(owner.closeAfterSettlement());
    clock += 2 * BENCH_EVIDENCE_MIN_AGE_MS;
    assert.equal((await collect()).retiredRuns, 0);
    settled = true; await owner.closeAfterSettlement();
    assert.equal(failure.cacheOwnershipReleased(), true);
    clock += 2 * BENCH_EVIDENCE_MIN_AGE_MS;
    assert.equal((await collect()).retiredRuns, 1);
  } else if (selected === 'handled-failure') {
    const ordinary = new Error('a failed child with an admitted report');
    await assert.rejects(owner.trackExternal(() => { throw ordinary; }, { reportFailure: false }), error => error === ordinary);
    await owner.finish(); assert.equal(owner.isSettled(), true);
    assert.equal(JSON.parse(await fs.readFile(path.join(owner.runDir, BENCH_EVIDENCE_SETTLED), 'utf8')).eligible, true);
  } else if (selected === 'closed') {
    await assert.rejects(owner.closeAfterSettlement(), code('ERR_BENCH_EVIDENCE_OWNER_ACTIVE'));
    await owner.finish();
    assert.throws(() => owner.registerFile('late.json'), code('ERR_BENCH_EVIDENCE_FILE'));
    assert.throws(() => owner.markReferenced(), code('ERR_BENCH_EVIDENCE_OWNER_CLOSED'));
    let calls = 0;
    assert.throws(() => owner.trackExternal(() => { calls++; }), code('ERR_BENCH_EVIDENCE_OWNER_CLOSED'));
    assert.equal(calls, 0); await owner.closeAfterSettlement();
  } else {
    if (selected === 'pinned') owner.markReferenced();
    if (selected === 'final') await owner.writeText('final.json', '{}\n');
    if (selected === 'nested') { await fs.mkdir(path.join(owner.runDir, 'unknown')); await fs.writeFile(path.join(owner.runDir, 'unknown', 'keep'), 'unknown child'); }
    if (selected !== 'active') await owner.finish();
    if (selected === 'unknown') {
      await fs.mkdir(path.join(familyRoot, 'run-abc123'));
      await fs.writeFile(path.join(familyRoot, 'run-abc123', 'keep'), 'unowned evidence');
    }
    if (selected === 'changed') await fs.writeFile(payload, 'changed since settlement');
    if (selected === 'extra') await fs.writeFile(path.join(owner.runDir, 'unknown.json'), 'new independent file');
    if (selected === 'shared-file') await fs.link(payload, path.join(root, 'independent-reference'));
    if (selected === 'changed-record') {
      const record = path.join(owner.runDir, BENCH_EVIDENCE_SETTLED);
      const value = JSON.parse(await fs.readFile(record, 'utf8'));
      value.runId = '11111111-1111-1111-1111-111111111111';
      await fs.writeFile(record, JSON.stringify(value));
    }
    let copy;
    if (selected === 'copied') { copy = path.join(familyRoot, 'run-ABC123'); await fs.cp(owner.runDir, copy, { recursive: true, errorOnExist: true, force: false }); }
    clock += selected === 'recent' ? BENCH_EVIDENCE_MIN_AGE_MS - 1 : 2 * BENCH_EVIDENCE_MIN_AGE_MS;
    const unlink = fs.unlink;
    if (selected === 'late-child') fs.unlink = async filename => {
      if (filename === payload) await fs.writeFile(path.join(owner.runDir, 'late-child'), 'must survive');
      return unlink(filename);
    };
    let outcome;
    try { outcome = await collect(); } finally { fs.unlink = unlink; }
    const retired = ['old', 'unknown', 'copied'].includes(selected);
    assert.equal(outcome.complete, true); assert.equal(outcome.retiredRuns, retired ? 1 : 0);
    assert.equal(await exists(owner.runDir), !retired);
    if (retired) { assert.ok(outcome.retiredFiles >= 3); assert.ok(outcome.retiredLogicalBytes > 0); }
    if (selected === 'unknown') assert.equal(await fs.readFile(path.join(familyRoot, 'run-abc123', 'keep'), 'utf8'), 'unowned evidence');
    if (copy) assert.equal(await exists(path.join(copy, 'payload.json')), true, 'copied marker identities grant no authority over another physical directory');
    if (selected === 'late-child') assert.equal(await fs.readFile(path.join(owner.runDir, 'late-child'), 'utf8'), 'must survive');
    if (selected === 'active') await owner.finish();
  }
} finally {
  settled = true;
  if (owner && !owner.isSettled()) { try { await owner.finish(); } catch { await owner.closeAfterSettlement(); } }
  const resolved = path.resolve(root);
  assert.ok(resolved.startsWith(parent + path.sep), 'recursive fixture cleanup stays in its original temporary parent');
  await fs.rm(resolved, { recursive: true, force: true });
}
console.log(`Benchmark evidence retirement: ${selected}`);
