import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildDefaultDocMeta } from '../../../src/lang/shared.js';
import { mergeFlowMeta } from '../../../src/index/build/file-processor/meta.js';
import { FLOW_FIELDS, admitFlowEvidence, createFlowEvidence, flowSourceIdentity } from '../../../src/shared/flow-evidence.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { validateMetadataV2Semantics } from '../../../src/contracts/validators/metadata.js';
import { serializeCachedRow } from '../../../src/index/build/artifacts/writers/chunk-meta/shared.js';
import { readCachedBundle, writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { sha1 } from '../../../src/shared/hash.js';
import { enrichFlowFixture, assembleFlowFixture } from '../../helpers/chunk-flow-fixture.js';
import { createImportResolutionTempRoot } from '../../helpers/import-resolution-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const text = 'fixture function body';
const chunk = { start: 0, end: text.length, name: 'f', kind: 'FunctionDeclaration', meta: {} };
const source = flowSourceIdentity({ text, chunk, languageId: 'groovy' });
const positive = { dataflow: { reads: ['a'], writes: ['b'], mutations: [], aliases: [] },
  controlFlow: { branches: 1 }, throws: ['E'], awaits: ['task'], yields: true, returnsValue: true };
const negative = { dataflow: { reads: [], writes: [], mutations: [], aliases: [] },
  controlFlow: { branches: 0 }, throws: [], awaits: [], yields: false, returnsValue: false };
const qualified = (values, scope = 'fixture-function-effects') => ({ ...values,
  flowEvidence: createFlowEvidence({ values, source, producer: { id: 'fixture-owned-analysis', version: '1' }, authority: 'semantic', scope }) });
const flags = { astDataflowEnabled: true, controlFlowEnabled: true };

for (const field of FLOW_FIELDS) for (const absent of [undefined, null]) {
  const defaults = buildDefaultDocMeta({ meta: { [field]: absent } });
  assert.equal(Object.hasOwn(defaults, field), false, `${field}/${absent} stays unknown`);
  const out = mergeFlowMeta(defaults, { [field]: positive[field] }, flags);
  assert.deepEqual(out[field], positive[field]);
  assert.equal(out.flowEvidence.fields[field].state, 'partial', 'unqualified producers retain partial provenance');
}
const defaults = buildDefaultDocMeta(chunk);
const admitted = mergeFlowMeta(defaults, positive, flags);
for (const field of FLOW_FIELDS) assert.deepEqual(admitted[field], positive[field]);
assert.equal(Object.hasOwn(defaults, 'returnsValue'), false);
const retained = mergeFlowMeta(qualified(negative), positive, flags);
for (const field of FLOW_FIELDS) {
  assert.deepEqual(retained[field], negative[field]);
  assert.equal(retained.flowEvidence.fields[field].state, 'produced-empty');
}
assert.ok(retained.flowEvidence.diagnostics.every(item => item.code === 'lower_authority_ignored'));
const conflict = mergeFlowMeta(qualified(negative), qualified(positive), flags);
for (const field of FLOW_FIELDS) {
  assert.deepEqual(conflict[field], negative[field], 'equal-authority conflicts retain the first value without union');
  assert.equal(conflict.flowEvidence.fields[field].state, 'conflict');
}
const incomparable = mergeFlowMeta(qualified(negative), qualified(positive, 'other-analysis-scope'), flags);
assert.ok(incomparable.flowEvidence.diagnostics.every(item => item.code === 'incomparable_scope_or_fact_kind'));
for (const variant of [{ ...source, generation: 'different' }, { ...source, textHash: '0'.repeat(64) },
  { ...source, range: { start: 1, end: text.length } }]) {
  const incoming = { ...positive, flowEvidence: createFlowEvidence({ values: positive, source: variant,
    authority: 'semantic', producer: { id: 'fixture-other-source', version: '1' } }) };
  assert.throws(() => mergeFlowMeta(qualified(negative), incoming, flags), { code: 'ERR_FLOW_EVIDENCE_CONTRACT' });
}
const disabled = mergeFlowMeta(qualified(positive), qualified(negative), { astDataflowEnabled: false, controlFlowEnabled: false });
for (const field of FLOW_FIELDS) {
  assert.equal(disabled[field], undefined); assert.equal(disabled.flowEvidence.fields[field].state, 'disabled');
}
const unavailable = mergeFlowMeta({}, null, flags);
for (const field of FLOW_FIELDS) assert.equal(unavailable.flowEvidence.fields[field].state, 'unknown');
for (const controlFlowEnabled of [true, false]) {
  const mixed = mergeFlowMeta({}, positive, { astDataflowEnabled: !controlFlowEnabled, controlFlowEnabled });
  for (const field of FLOW_FIELDS) assert.equal(mixed.flowEvidence.fields[field].state,
    (field === 'controlFlow' ? controlFlowEnabled : !controlFlowEnabled) ? 'partial' : 'disabled');
}
const frozen = qualified(negative); Object.freeze(frozen.dataflow.reads); Object.freeze(frozen.dataflow); Object.freeze(frozen);
const owned = mergeFlowMeta(frozen, positive, flags); owned.dataflow.reads.push('new');
assert.deepEqual(frozen.dataflow.reads, [], 'owned output cannot mutate another projection');
assert.throws(() => admitFlowEvidence(owned.flowEvidence, owned), { code: 'ERR_FLOW_EVIDENCE_CONTRACT' });

// Use the registered adapter and the production enrichment/assembly owner. The
// injected fact qualifies this handoff only, never the language parser itself.
const lang = getLanguageForFile('.groovy', 'fixture.groovy'), savedFlow = lang.flow;
try {
  lang.flow = () => qualified(positive);
  const docmeta = enrichFlowFixture({ text, chunk, lang });
  for (const field of FLOW_FIELDS) assert.deepEqual(docmeta[field], positive[field]);
  const payload = assembleFlowFixture({ text, chunk, docmeta });
  assert.deepEqual(validateMetadataV2Semantics(payload.metaV2), []);
  const serialized = JSON.parse(serializeCachedRow(payload));
  assert.deepEqual(serialized.docmeta.flowEvidence, docmeta.flowEvidence);
  assert.deepEqual(serialized.metaV2.flowEvidence, docmeta.flowEvidence);
  const corrupt = structuredClone(serialized.metaV2); corrupt.returnsValue = false;
  assert.ok(validateMetadataV2Semantics(corrupt).length);
  const root = await createImportResolutionTempRoot('flow-field-authority');
  try {
    const absPath = path.join(root, 'fixture.groovy'); await fs.writeFile(absPath, text);
    const stat = await fs.stat(absPath), bundleDir = path.join(root, 'bundles'); await fs.mkdir(bundleDir);
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, bundleFormat: 'json', files: {} };
    manifest.files['fixture.groovy'] = await writeIncrementalBundle({ enabled: true, bundleDir, manifest, relKey: 'fixture.groovy',
      fileStat: stat, fileHash: sha1(text), fileChunks: [payload], bundleFormat: 'json', fileRelations: {} });
    const cached = await readCachedBundle({ enabled: true, absPath, relKey: 'fixture.groovy', fileStat: stat, manifest, bundleDir, bundleFormat: 'json' });
    const restored = cached.cachedBundle?.chunks;
    assert.ok(restored?.length, 'the actual incremental bundle reader restores a chunk');
    assert.deepEqual(restored[0].docmeta.flowEvidence, docmeta.flowEvidence);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
} finally { lang.flow = savedFlow; }
console.log('Flow field presence, source identity, authority and conflicts survive enrichment and durable serialization.');
