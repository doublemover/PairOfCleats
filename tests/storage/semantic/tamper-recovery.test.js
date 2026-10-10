#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateSemanticPartitions } from '../../../src/index/semantic/reconcile.js';
import { createRecoveryFixture, semanticNode, sha256 } from '../../helpers/semantic-recovery.js';

const fixture = await createRecoveryFixture('/* 🧭 */\r\nf(1);');
try {
  const descriptor = await fixture.write([semanticNode(0, fixture.source.textLength), semanticNode(1, fixture.source.textLength)]);
  const ref = { partitionId: fixture.partitionId, localId: 0 };
  const store = fixture.store([descriptor]);
  await validateSemanticPartitions({ store, partitions: [descriptor] });
  assert.equal((await store.getSourceSpans([ref]))[0].text, fixture.bytes.toString());
  const piece = descriptor.members.semantic_records[0];
  const dataPath = path.join(fixture.stagingRoot, piece.path);
  const data = await fs.readFile(dataPath);
  const changed = Buffer.from(data);
  const index = changed.indexOf(Buffer.from('Identifier'));
  changed[index] = 'X'.charCodeAt(0);
  await fs.writeFile(dataPath, changed);
  await assert.rejects(store.getRecords([ref]), { code: 'ERR_SEMANTIC_INTEGRITY' },
    'same-size data edits must invalidate warmed validation metadata');
  await fs.writeFile(dataPath, data);

  const offsetsPath = path.join(fixture.stagingRoot, piece.offsetsPath);
  const offsets = await fs.readFile(offsetsPath);
  const shifted = Buffer.from(offsets);
  shifted.writeBigUInt64LE(1n, 8);
  await fs.writeFile(offsetsPath, shifted);
  await assert.rejects(store.getRecords([ref]), { code: 'ERR_SEMANTIC_INTEGRITY' });
  const forged = structuredClone(descriptor);
  forged.members.semantic_records[0].offsetsHash = sha256(shifted);
  await assert.rejects(fixture.store([forged]).getRecords([ref]), /offset|line|boundary/i,
    'matching forged checksum cannot make an invalid line offset admissible');
  await fs.writeFile(offsetsPath, offsets);

  const sourcePath = path.join(fixture.stagingRoot, 'semantic-sources', fixture.source.byteHash + '.utf8');
  const sourceEdit = Buffer.from(fixture.bytes);
  sourceEdit[0] = 'X'.charCodeAt(0);
  await fs.writeFile(sourcePath, sourceEdit);
  await assert.rejects(store.getSourceSpans([ref]), { code: 'ERR_SEMANTIC_INTEGRITY' });
  await assert.rejects(fixture.write(), /Conflicting semantic source blob/,
    'retry cannot overwrite an existing content-addressed source with conflicting bytes');
  assert.deepEqual(await fs.readFile(fixture.original), fixture.bytes);
  await fs.writeFile(sourcePath, fixture.bytes);
  await validateSemanticPartitions({ store, partitions: [descriptor] });
  assert.equal((await store.getSourceSpans([ref]))[0].coordinateUnit, 'utf16');
  console.log('semantic data, offset and exact-source tamper rejection passed');
} finally { await fixture.cleanup(); }

// Split a four-byte UTF-8 scalar across the verifier's 64 KiB reads, preserving BOM and CRLF.
const streamed = await createRecoveryFixture('\uFEFF' + 'a'.repeat(65531) + '🧭\r\nend');
try {
  const descriptor = await streamed.write();
  const store = streamed.store([descriptor]);
  await validateSemanticPartitions({ store, partitions: [descriptor] });
  await store.verifySource(streamed.source);
  await assert.rejects(store.verifySource({ ...streamed.source, textHash: 'f'.repeat(64) }),
    { code: 'ERR_SEMANTIC_INTEGRITY' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(store.verifySource(streamed.source, { signal: controller.signal }), { name: 'AbortError' });
} finally { await streamed.cleanup(); }
