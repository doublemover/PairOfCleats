#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordsReusePolicy, readReusableRecordChunk } from '../../../src/integrations/triage/records-reuse.js';
import { writeIncrementalBundle } from '../../../src/index/build/incremental.js';
import { recordsLogicalContentHash } from '../../../src/integrations/triage/index-records.js';
import { buildMetaV2 } from '../../../src/index/metadata-v2.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
applyTestEnv({ testing: '1' });
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-record-reuse-'));
try {
  const runtime = { embeddingEnabled: false, embeddingService: false, indexingConfig: {} };
  const input = { runtime, policy: { promoteFields: ['source'], dictionary: 'one' }, stop: new Set(['a']), synonyms: [['err', 'error']] };
  const policy = recordsReusePolicy(input), file = 'triage/records/finding.md', text = 'Exact Finding';
  const logicalHash = recordsLogicalContentHash({ text, record: { source: 'one' }, recordMeta: {}, policy: policy.snapshot });
  const bundleDir = path.join(root, 'bundles');
  const chunk = { id: 91, chunkId: 'record:chunk', file, start: 0, end: text.length, kind: 'Record', chunkUid: 'record:stable',
    tokens: ['exact', 'find'], seq: ['exact', 'find'], phraseTokens: ['Exact', 'Finding'], phraseTokensCasePreserved: true,
    stats: { tokenCount: 2 }, minhashSig: [1, 2], docmeta: { source: 'one' } };
  chunk.metaV2 = buildMetaV2({ chunk, docmeta: chunk.docmeta });
  const entry = await writeIncrementalBundle({ enabled: true, bundleDir, relKey: file,
    fileStat: { size: text.length, mtimeMs: 100 }, fileHash: logicalHash,
    dependencySignatures: { recordsProducer: policy.key }, fileChunks: [chunk], bundleFormat: 'json' });
  const incrementalState = { enabled: true, bundleDir, bundleFormat: 'json', manifest: { files: { [file]: entry } } };
  const read = overrides => readReusableRecordChunk({ incrementalState, repoRoot: root, file, logicalHash,
    policy, textLength: text.length, ...overrides });
  const first = await read(); assert.equal(first.reason, 'sealed-record-products'); assert.deepEqual(first.chunk, chunk);
  first.chunk.id = 0; first.chunk.tokens.push('private');
  assert.deepEqual((await read()).chunk, chunk, 'replay products have private ownership and global IDs can be remapped');
  for (const changed of [
    { ...input, policy: { ...input.policy, promoteFields: ['package'] } },
    { ...input, policy: { ...input.policy, dictionary: 'two' } },
    { ...input, stop: new Set(['different']) },
    { ...input, synonyms: [['err', 'changed']] },
    { ...input, runtime: { ...runtime, embeddingService: true } },
    { ...input, runtime: { ...runtime, toolInfo: { version: 'changed-producer' } } },
    { ...input, runtime: { ...runtime, analysisPolicy: { metadata: { enabled: false } } } }
  ]) { const next = recordsReusePolicy(changed); assert.notEqual(next.key, policy.key); assert.equal((await read({ policy: next })).chunk, null); }
  assert.equal(recordsReusePolicy({ ...input, runtime: { ...runtime, embeddingEnabled: true } }).allowed, false);
  assert.equal((await read({ logicalHash: recordsLogicalContentHash({ text, record: { source: 'two' }, recordMeta: {}, policy: policy.snapshot }) })).chunk, null);
  const vectorPolicy = recordsReusePolicy({ ...input, runtime: { ...runtime, embeddingEnabled: true, embeddingIdentityKey: 'model:1',
    embeddingIdentity: { dims: 2, modelArtifact: { status: 'stub', reuse: 'allow' } } } });
  assert.equal(vectorPolicy.allowed, true);
  assert.notEqual(vectorPolicy.key, recordsReusePolicy({ ...input, runtime: { ...runtime, embeddingEnabled: true, embeddingIdentityKey: 'model:2',
    embeddingIdentity: { dims: 2, modelArtifact: { status: 'stub', reuse: 'allow' } } } }).key);
  const oldChunk = structuredClone(chunk);
  delete oldChunk.metaV2;
  const oldEntry = await writeIncrementalBundle({ enabled: true, bundleDir, relKey: file,
    fileStat: { size: text.length, mtimeMs: 100 }, fileHash: logicalHash,
    dependencySignatures: { recordsProducer: policy.key }, fileChunks: [oldChunk], bundleFormat: 'json' });
  incrementalState.manifest.files[file] = oldEntry;
  assert.equal((await read()).reason, 'incompatible-record-products', 'legacy products require canonical metadata recomputation');
  assert.notEqual(logicalHash, recordsLogicalContentHash({ text, record: { source: 'one' }, recordMeta: {},
    policy: policy.snapshot, sourceHash: 'changed-raw-source' }), 'raw source identity is part of replay admission');
  await fs.writeFile(path.join(bundleDir, oldEntry.bundles[0]), '{}');
  await assert.rejects(read(), { code: 'ERR_INDEX_FORMAT_UNSUPPORTED' }, 'unsupported cached formats retain their strict error contract');
  await fs.writeFile(path.join(bundleDir, oldEntry.bundles[0]), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION }));
  assert.equal((await read()).chunk, null, 'corrupt cached products recompute');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(read({ signal: controller.signal }), { code: 'ABORT_ERR' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
