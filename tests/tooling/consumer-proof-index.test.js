import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildConsumerProofIndex, compareConsumerProofIndexes } from '../../tools/testing/consumer-proof-index.js';
import { createGovernanceSnapshot } from '../runner/governance-snapshot.js';
import { generateLaneManifests } from '../runner/lane-manifests.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/consumer-proof-index/')[1];
assert.ok(['projection', 'reference-guards', 'source-diff', 'consolidation-controls'].includes(mode));
const { dir: root } = await prepareIsolatedTestCacheDir('consumer-proof-index');
const write = async (name, bytes) => {
  const target = path.join(root, name); await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, typeof bytes === 'string' ? bytes : JSON.stringify(bytes));
};
const witness = { contractId: 'physical-source-distinction', consumerId: 'fixture-consumer', caseId: 'one/positive',
  sourcePaths: ['src/consumer.js'], requiredScope: ['Distinct sources cannot inherit another physical observation.'],
  expectedOracleKind: 'physical-identity', negativeCaseIds: ['one/negative'] };
const ownership = { schemaVersion: 1, suites: [{ id: 'one', suiteCategory: 'matrix', coverageOwner: 'Fixture consumer',
  replacementIds: ['retired/unit'], overlapPolicy: 'review-required', processIsolationRequired: true }], consumerWitnesses: [witness] };
const ownershipPath = 'docs/testing/consolidation-ownership.json';
const snapshot = async () => {
  const value = await createGovernanceSnapshot({ root });
  await generateLaneManifests({ root, snapshot: value }); return value;
};
try {
  await write('tests/one.test.js', 'throw new Error("read-only reports must never execute this fixture");\n');
  await write('tests/one.test.js.cases.json', { schemaVersion: 1, cases: ['positive', 'negative'] });
  await write('tests/run.rules.jsonc', '{}');
  await write('tests/runner/lane-manifests.jsonc', { orderedLanes: { gate: {
    orderFile: 'tests/gate.order.txt', manifestFile: 'tests/gate.manifest.json' } } });
  await write('tests/gate.order.txt', 'one/positive\none/negative\n');
  await write('src/consumer.js', 'export const value = 1;\n');
  await write(ownershipPath, ownership);
  await write('docs/tooling/shipped-surfaces.json', { schemaVersion: '1.0.0', surfaces: [{
    id: 'cli', name: 'Fixture CLI', owner: 'fixture-owner', supportLevel: 'supported',
    packagingBoundary: 'package', publishBoundary: 'package', versionSource: 'package.json', runtimeTargets: ['node'],
    build: { kind: 'source', sourcePaths: ['src/consumer.js'], outputs: [] },
    install: { kind: 'package', summary: 'Fixture declaration only' }, smoke: { summary: 'Not executed' },
    releaseCheck: { enabled: true, steps: [{ id: 'smoke.fixture', phase: 'smoke', label: 'Not executed', command: ['$NODE', 'never-run.js'] }] }
  }] });
  const initialSnapshot = await snapshot();
  const before = await buildConsumerProofIndex({ root, snapshot: initialSnapshot });
  if (mode === 'projection') {
    const readdir = fs.readdir;
    try {
      fs.readdir = async () => { throw new Error('proof projection must reuse the original discovery'); };
      const report = await buildConsumerProofIndex({ root, snapshot: initialSnapshot });
      assert.equal(report.mode, 'observe-only'); assert.equal(report.summary.qualifiedWitnesses, 0);
      assert.equal(report.summary.cases, 2); assert.equal(report.summary.declaredWitnesses, 1);
      assert.equal(report.sourceManifestDigest, before.sourceManifestDigest);
      assert.deepEqual(report.cases.map(row => row.executionStatus), ['unobserved', 'unobserved']);
      assert.equal(report.witnesses[0].semanticCompleteness, 'unqualified'); assert.equal(report.witnesses[0].originalReceiptRef, null);
      assert.deepEqual(report.cases[0].orderedLanes, ['gate']);
      assert.equal(report.consolidations[0].processIsolationRequired, true);
      assert.equal(report.consolidations[0].equivalenceStatus, 'declared-not-qualified');
      assert.deepEqual(report.consolidations[0].ownerCaseIds, ['one/positive', 'one/negative']);
      assert.deepEqual(report.surfaces[0].releaseCheckIds, ['smoke.fixture']);
      assert.ok(report.unavailable.includes('execution-receipts'));
      assert.ok(report.sources.some(row => row.path === 'tests/one.test.js.cases.json'));
    } finally { fs.readdir = readdir; }
    await assert.rejects(buildConsumerProofIndex({ root: path.join(root, 'other'), snapshot: initialSnapshot }), /root mismatch/);
  } else if (mode === 'reference-guards') {
    for (const replacement of [ { ...witness, caseId: 'missing/positive' },
      { ...witness, negativeCaseIds: ['missing/negative'] }, { ...witness, sourcePaths: ['../outside.js'] },
      { ...witness, expectedOracleKind: 'self-declared-passed' }, { ...witness, observedScope: 'passed' } ]) {
      await write(ownershipPath, { ...ownership, consumerWitnesses: [replacement] });
      await assert.rejects(buildConsumerProofIndex({ root }), /consumer witness|Consumer witness/);
    }
    await write(ownershipPath, { ...ownership, consumerWitnesses: [witness, witness] });
    await assert.rejects(buildConsumerProofIndex({ root }), /duplicate consumer witness/);
    await write(ownershipPath, ownership);
    await write('tests/one.test.js.cases.json', { schemaVersion: 1, cases: ['positive', 'negative', 'new'] });
    await assert.rejects(buildConsumerProofIndex({ root, snapshot: initialSnapshot }), /Changed case inventory/);
  } else if (mode === 'source-diff') {
    await write('src/consumer.js', 'export const value = 2;\n');
    const after = await buildConsumerProofIndex({ root });
    assert.notEqual(before.sourceManifestDigest, after.sourceManifestDigest, 'consumer changes invalidate content-bound evidence reuse');
    assert.deepEqual(compareConsumerProofIndexes(before, after).findings.map(row => row.kind), ['changed-consumer-source']);
    await write('tests/one.test.js', '// deliberately removed unique negative assertion\n');
    const changed = await buildConsumerProofIndex({ root });
    const delta = compareConsumerProofIndexes(after, changed);
    assert.equal(delta.findings.filter(row => row.kind === 'changed-case-source').length, 2);
    assert.ok(delta.findings.every(row => row.reviewRequired));
    assert.equal(delta.destructiveConsolidationQualified, false, 'same case names cannot certify preserved assertions');
  } else {
    const missing = structuredClone(before);
    missing.cases = missing.cases.filter(row => row.caseId !== 'one/negative');
    // Claiming a replacement/owner cannot waive an independently removed case.
    missing.consolidations[0].replacementIds.push('one/negative');
    assert.ok(compareConsumerProofIndexes(before, missing).findings.some(row => row.kind === 'removed-case' && row.caseId === 'one/negative'));
    const weaker = structuredClone(before); weaker.witnesses[0].negativeCaseIds = [];
    assert.ok(compareConsumerProofIndexes(before, weaker).findings.some(row => row.kind === 'changed-consumer-witness'));
    assert.deepEqual(compareConsumerProofIndexes(before, structuredClone(before)).findings, []);
    assert.throws(() => compareConsumerProofIndexes({ ...before, mode: 'executed' }, before), { code: 'ERR_CONSUMER_PROOF_INDEX' });
  }
} finally {
  assert.ok(path.relative(process.cwd(), root).startsWith(`.tmp${path.sep}`));
  await fs.rm(root, { recursive: true, force: true });
}
