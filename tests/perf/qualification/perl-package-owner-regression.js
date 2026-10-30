import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { applyTestEnv } from '../../helpers/test-env.js';

await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2], 'An explicit fresh receipt directory is required.');
const output = path.resolve(process.argv[2]); await fs.mkdir(output);
const source = captureSweepSource(process.cwd()), observations = [];
assert.equal(source.state, 'clean-revision', 'Both owner arms require the same committed source.');
for (const arm of ['original', 'current']) {
  const destination = path.join(output, arm);
  const result = await runQualificationCapsule({ args: ['tests/fixtures/benchmarks/perl-package-owner-regression.js', arm, destination],
    receiptPath: path.join(output, arm + '-invocation.json') });
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  const receipt = JSON.parse(await fs.readFile(path.join(destination, 'receipt.json'), 'utf8'));
  assert.equal(receipt.status, 'passed'); assert.equal(receipt.report.arm, arm);
  observations.push({ arm, capsuleMs: result.durationMs, receipt });
  console.log(JSON.stringify({ arm, capsuleMs: result.durationMs }));
}
const original = observations[0].receipt.report, current = observations[1].receipt.report;
assert.deepEqual(original.grammar, current.grammar, 'both arms use the same actual native grammar identity');
assert.deepEqual(original.cases.map(row => row.form), ['braced', 'nested', 'unbraced']);
assert.deepEqual(current.cases.map(row => row.form), ['braced', 'nested', 'unbraced']);
const transitions = [];
for (const [index, before] of original.cases.entries()) {
  const after = current.cases[index];
  for (const field of ['source', 'sourceHash', 'fileHash', 'sourceBytes', 'affected']) assert.deepEqual(after[field], before[field]);
  assert.deepEqual(after.nativeEnvelopes, before.nativeEnvelopes, 'both roles preserve the exact authored native envelopes and automatic terminators');
  assert.equal(before.identities.length, after.identities.length);
  for (const [rowIndex, oldRow] of before.identities.entries()) {
    const newRow = after.identities[rowIndex];
    for (const field of ['name', 'start', 'end', 'startLine', 'endLine', 'sourceSliceHash', 'tokens']) {
      assert.deepEqual(newRow[field], oldRow[field], 'owner replacement preserves the same source envelope: ' + field);
    }
    if (before.affected.includes(oldRow.name)) {
      assert.equal(oldRow.kind, 'MethodDeclaration'); assert.equal(newRow.kind, 'FunctionDeclaration');
      assert.notEqual(oldRow.chunkUid, newRow.chunkUid, 'canonical role-derived identity must change with the corrected role');
      transitions.push({ form: before.form, name: oldRow.name, originalUid: oldRow.chunkUid, currentUid: newRow.chunkUid,
        start: newRow.start, end: newRow.end, originalKind: oldRow.kind, currentKind: newRow.kind });
    } else {
      assert.equal(newRow.kind, oldRow.kind); assert.equal(newRow.chunkUid, oldRow.chunkUid);
    }
  }
  if (before.form === 'unbraced') {
    assert.deepEqual(after.identities, before.identities, 'the healthy semicolon package control retains canonical identity and relations');
    assert.deepEqual(after.callSites, before.callSites); assert.deepEqual(after.exports, before.exports);
  } else {
    assert.equal(before.assertion, 'old-wrong-roles-and-lost-relations-positively-observed');
    assert.deepEqual(before.rawCalls, []); assert.deepEqual(before.filteredCalls, []); assert.deepEqual(before.callSites, []);
    assert.equal(after.rawCalls.length, 1); assert.equal(after.filteredCalls.length, 1); assert.equal(after.callSites.length, 1);
  }
}
assert.equal(transitions.length, 3, 'two braced free subs and the nested outer sub discriminate the old defect');
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, issue: 1468, status: 'passed',
  historicalAuthorWorkspace: true, source, observations, transitions,
  scope: 'two serial fresh bounded children;explicit old-defect observations plus repaired positives;three identical Perl source envelopes',
  limits: 'only exact historical chunking owner replaced;current native grammar and all registered/canonical consumers;no failed command counted as acceptance or historical whole-tree claim' }, { createOnly: true });
