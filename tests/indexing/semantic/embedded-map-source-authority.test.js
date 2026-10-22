import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRecoveryFixture, semanticNode } from '../../helpers/semantic-recovery.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { semanticHash, createSyntaxPartitionId } from '../../../src/index/semantic/identity.js';
import { createSemanticFactsRef } from '../../../src/index/semantic/file-ref.js';
import { persistSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';
import { readRetainedEmbeddedSourceMap, assertRetainedEmbeddedSourceRange } from '../../../src/index/semantic/embedded-map-read.js';
import { assertEmbeddedSourceMap } from '../../../src/contracts/validators/embedded-source-map.js';
import { validateEmbeddedCacheSource } from '../../../src/index/semantic/embedded-cache.js';

// Canonical map/source writer controls only; no parser, compiler or LSP launch.
const f = await createRecoveryFixture('<script>const face = "😀";</script>');
try {
  const parent = await f.write();
  const parentFacts = createSemanticFactsRef({ source: f.source, partitions: [parent],
    syntaxPartitionId: parent.partitionId, storage: { generation: f.generation, relativePath: 'semantic' }, coverage: [] });
  const parentText = f.bytes.toString(), start = 8, end = parentText.indexOf('</script>');
  const localText = parentText.slice(start, end), localBytes = Buffer.from(localText);
  const map = { schemaVersion: 1, kind: 'embedded-linear-range', quality: 'exact',
    parentSourceUnitId: f.source.sourceUnitId, parentByteHash: f.source.byteHash,
    parentStart: start, parentEnd: end, localStart: 0, localEnd: localText.length,
    coordinateUnit: 'utf16', segmentUid: 'fixture-segment', language: 'typescript' };
  const identity = semanticHash('semantic.embedded-map.v1', map);
  const mapRef = await persistSemanticEvidence({ value: map, stagingRoot: f.stagingRoot,
    diskAccount: f.account, inventory: [] });
  const snapshot = createSemanticSourceSnapshot({ bytes: localBytes, repositoryNamespace: f.root,
    path: 'original.js.semantic-segments/' + identity + '.ts', language: 'typescript',
    mapping: { identity, parentSourceUnitId: f.source.sourceUnitId, mapRef, quality: 'exact' } });
  const partitionId = createSyntaxPartitionId({ sourceUnitId: snapshot.manifest.sourceUnitId,
    parser: { family: 'map-fixture', version: '1', options: {} }, extractor: { schemaVersion: 1, version: '1' }, structuralPolicy: {} });
  const local = await f.write([semanticNode(0, localText.length)], { source: snapshot.manifest,
    sourceBytes: localBytes, sourceCapability: snapshot.sourceCapability, partitionId });
  const store = f.store([parent, local]);
  assert.deepEqual(await readRetainedEmbeddedSourceMap({ store, source: snapshot.manifest, parentFacts }), map);
  assert.equal(assertRetainedEmbeddedSourceRange({ map, source: snapshot.manifest, localText,
    parentSource: f.source, parentText }), map);
  assert.throws(() => assertEmbeddedSourceMap({ ...map, localStart: 1 }), { code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT' });
  assert.throws(() => assertEmbeddedSourceMap({ ...map, localEnd: localText.length - 1 }), { code: 'ERR_EMBEDDED_SOURCE_MAP_CONTRACT' });
  assert.throws(() => assertRetainedEmbeddedSourceRange({ map, source: snapshot.manifest, localText,
    parentSource: { ...f.source, sourceUnitId: 'su1:' + '0'.repeat(64) }, parentText }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  assert.throws(() => assertRetainedEmbeddedSourceRange({ map, source: snapshot.manifest,
    localText: localText.replace('face', 'fake'), parentSource: f.source, parentText }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const insidePair = parentText.indexOf('😀') + 1;
  const split = { ...map, quality: 'synthetic', parentStart: insidePair, parentEnd: insidePair + 1 };
  const splitSource = { ...snapshot.manifest, mapping: { ...snapshot.manifest.mapping, quality: 'synthetic',
    identity: semanticHash('semantic.embedded-map.v1', split) } };
  assert.throws(() => assertRetainedEmbeddedSourceRange({ map: split, source: splitSource, localText,
    parentSource: f.source, parentText }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  await assert.rejects(readRetainedEmbeddedSourceMap({ store, source: { ...snapshot.manifest,
    mapping: { ...snapshot.manifest.mapping, mapRef: '../outside.json' } }, parentFacts }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  await assert.rejects(validateEmbeddedCacheSource({ opened: { store, factsRef: { syntaxPartitionId: local.partitionId } },
    parentFacts, parentBytes: Buffer.from(parentText.replace('face', 'fake')), segmentUid: map.segmentUid }),
  { code: 'ERR_SEMANTIC_CACHE_INTEGRITY' }, 'equal-layout bytes cannot stand in for the admitted retained parent');
  const mapPath = path.join(f.stagingRoot, mapRef);
  await fs.appendFile(mapPath, ' ');
  await assert.rejects(readRetainedEmbeddedSourceMap({ store, source: snapshot.manifest, parentFacts }), { code: 'ERR_FILE_INTEGRITY' });
} finally { await f.cleanup(); }
console.log('embedded map framing, exact parent/source authority and cache controls passed');
