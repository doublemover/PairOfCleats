#!/usr/bin/env node
import assert from 'node:assert/strict';
import { validatePairedTrialOutputs } from '../../../tools/history/eg2-paired-contract.js';
import { qualifyRetrieval } from '../../../tools/history/eg2-qualify-quality.js';
const identity = { provider: 'cpu', modelRevision: 'a'.repeat(40), modelSha256: 'a'.repeat(64),
  tokenizerSha256: 'b'.repeat(64), graphSha256: 'c'.repeat(64), runtimeVersion: 'test', dtype: 'fp32',
  documentPrefix: 'doc: ', queryPrefix: 'query: ', chunkerIdentity: 'fixture1', dimensions: 2, maxLength: 8192 };
const side = { identity, documents: [{ id: 'constructor', effectiveInput: 'doc: exact', vector: [1, 0] },
  { id: 'target', effectiveInput: 'doc: target', vector: [0, 1] }],
queries: [{ id: '__proto__', effectiveInput: 'query: exact', vector: [1, 0] }] };
const paired = { reference: structuredClone(side), candidate: structuredClone(side), k: 2,
  judgments: JSON.parse('{"__proto__":{"target":1}}') };
paired.candidate.identity.dtype = 'q8'; paired.candidate.identity.graphSha256 = 'd'.repeat(64);
validatePairedTrialOutputs(paired);
assert.ok(Number.isFinite(qualifyRetrieval(paired).candidateMetrics.ndcgAtK));
for (const key of ['tokenizerSha256', 'documentPrefix', 'queryPrefix', 'modelRevision', 'maxLength', 'dimensions', 'chunkerIdentity']) {
  const changed = structuredClone(paired); changed.candidate.identity[key] = key === 'dimensions' ? 3 : key === 'maxLength' ? 4000 : 'different';
  assert.throws(() => validatePairedTrialOutputs(changed));
}
const changed = structuredClone(paired); changed.candidate.documents[0].effectiveInput = 'doc: unrelated';
assert.throws(() => validatePairedTrialOutputs(changed));
delete changed.candidate.documents[0].effectiveInput;
assert.throws(() => validatePairedTrialOutputs(changed));
