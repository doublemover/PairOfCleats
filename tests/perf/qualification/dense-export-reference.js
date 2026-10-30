import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { readVerifiedContainedFile } from '../../../src/shared/contained-file.js';
import { atomicWriteJson } from '../../../src/shared/io/atomic-write.js';
import { captureSweepSource } from '../../../tools/bench/ab-sweep-source.js';
import { runQualificationCapsule } from '../../../tools/bench/qualification-capsule.js';
import { assertDenseReferenceManifest } from '../../embeddings/helpers/dense-upstream-reference.js';
import { loadDenseJudgedCorpus, summarizeDenseJudgments } from '../../embeddings/helpers/dense-judged-corpus.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// Manual serial controller: <manifest> <fresh-output> routes|documents|queries|quality.
// No acquisition, stub substitution, optional skip, retry or larger deadline.
await requireBootstrap(); applyTestEnv();
assert.ok(process.argv[2] && process.argv[3]);
const manifestPath = path.resolve(process.argv[2]), output = path.resolve(process.argv[3]), selection = process.argv[4] || 'quality';
assert.ok(['routes', 'documents', 'queries', 'quality'].includes(selection));
const manifestRead = await readVerifiedContainedFile(path.dirname(manifestPath), manifestPath, { maxBytes: 1024 * 1024, hashAlgorithm: 'sha256' });
const manifest = JSON.parse(manifestRead.buffer.toString('utf8')); assertDenseReferenceManifest(manifest);
const corpus = await loadDenseJudgedCorpus({ manifest });
const source = captureSweepSource(process.cwd()); assert.equal(source.state, 'clean-revision');
await fs.mkdir(output);
const observations = [];
const run = async (name, route, cohort = null, reference = null, observation = null) => {
  const destination = path.join(output, name);
  const args = ['tests/embeddings/actual-export-qualification.js', '--manifest', manifestPath, '--route', route, '--out', destination,
    ...(cohort ? ['--cohort', cohort] : []), ...(reference ? ['--numerical-reference', path.join(output, reference, 'receipt.json')] : []),
    ...(observation ? ['--observation', observation] : [])];
  const actual = await runQualificationCapsule({ args, receiptPath: path.join(output, name + '-invocation.json') });
  assert.equal(actual.stderr, '');
  const receiptPath = path.join(destination, 'receipt.json');
  const read = await readVerifiedContainedFile(destination, receiptPath, { maxBytes: 16 * 1024 * 1024, hashAlgorithm: 'sha256' });
  const receipt = JSON.parse(read.buffer.toString('utf8'));
  assert.equal(receipt.status, route === 'upstream-reference' ? 'numerical-reference' : 'passed');
  assert.equal(receipt.manifest.sha256, manifestRead.hash); assert.deepEqual(receipt.source, source);
  assert.equal(receipt.modelArtifact.status, 'verified'); assert.ok(receipt.elapsedMs < 30000);
  assert.equal(receipt.execution.stub, false); assert.equal(receipt.cohort, cohort || undefined);
  observations.push({ name, route, cohort, capsuleMs: actual.durationMs, receiptPath, sha256: read.hash, receipt });
  console.log(JSON.stringify({ name, capsuleMs: actual.durationMs }));
  return receipt;
};
let judgments = null;
if (selection === 'routes') {
  await run('raw-routes', 'upstream-reference');
  for (const route of ['single', 'batch', 'query']) {
    await run('product-' + route, route, null, 'raw-routes');
  }
} else {
  const pairs = {};
  for (const kind of selection === 'quality' ? ['documents', 'queries'] : [selection]) {
    pairs['reference' + kind] = await run('raw-' + kind, 'upstream-reference', 'judged-' + kind);
    pairs['candidate' + kind] = await run('product-' + kind, kind === 'documents' ? 'batch' : 'query', 'judged-' + kind, 'raw-' + kind);
    assert.deepEqual(pairs['reference' + kind].modelArtifact, pairs['candidate' + kind].modelArtifact);
  }
  if (selection === 'quality') judgments = summarizeDenseJudgments({ corpus,
    referenceDocuments: pairs.referencedocuments.judged.rows, candidateDocuments: pairs.candidatedocuments.judged.rows,
    referenceQueries: pairs.referencequeries.judged.rows, candidateQueries: pairs.candidatequeries.judged.rows });
}
assert.deepEqual(captureSweepSource(process.cwd()), source);
await atomicWriteJson(path.join(output, 'final.json'), { schemaVersion: 1, historicalAuthorWorkspace: true, source,
  modelId: manifest.modelId, exportRevision: manifest.exportRevision, manifest: { path: manifestPath, sha256: manifestRead.hash },
  selection, observations, judgments,
  scope: 'Serial original model lifetimes,each30seconds,zero retries;exact matching reference batches;quality separate from latency/token/output/allocation/memory observations.',
  limits: ['Tiny authored closed-world relevance set;no representative retrieval gain.', 'Shared ONNX/runtime reference;no independent PyTorch conversion proof.',
    'Prepared EG2 remains unsupported here.', 'Warm adapter/token-estimate observations do not qualify end-to-end query-result cache performance.',
    'Finite16-document campaigns do not qualify32-row output-admission costs;use original MiniLM/EG2 resources owner with32–64 supplied texts.',
    'Upstream comparison is not same-source old/current validation performance;that acceptance remains separate.'] }, { createOnly: true });
