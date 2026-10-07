#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Packr } from 'msgpackr';
import { readBundleFile, writeBundleFile, writeBundlePatch } from '../../../src/shared/bundle-io.js';
import { canonicalizeBundlePayloadForChecksum } from '../../../src/shared/bundle-checksum.js';
import { checksumBundlePayloadLocal } from '../../../src/shared/bundle-io-checksum.js';
import { BUNDLE_CHECKSUM_SCHEMA_VERSION, BUNDLE_FORMAT_TAG, BUNDLE_VERSION } from '../../../src/shared/bundle-io-constants.js';
import { MAX_BUNDLE_CHECKSUM_BYTES } from '../../../src/shared/bundle-contract.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `bundle-codec-parity-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
try {
  const results = [];
  for (const [name, extra] of [
    ['uint8', { embedding_u8: new Uint8Array([1, 2, 3]) }],
    ['buffer', { embedding_u8: Buffer.from([1, 2, 3]) }]
  ]) {
    for (const format of ['json', 'msgpack']) {
      const bundlePath = path.join(root, `${name}-${format}.${format === 'json' ? 'json' : 'mpk'}`);
      await writeBundleFile({ bundlePath, format, bundle: { file: 'src/fixture-🦀.js',
        chunks: [{ chunkUid: 'fixture', text: 'fixture', ...extra }] } });
      const read = await readBundleFile(bundlePath, { format });
      results.push({ case: `${name}-${format}`, ok: read.ok, reason: read.reason || null });
      if (read.ok) assert.deepEqual(Array.from(read.bundle.chunks[0].embedding_u8), [1, 2, 3]);
    }
  }
  for (const format of ['json', 'msgpack']) {
    const bundlePath = path.join(root, `omitted-${format}.${format === 'json' ? 'json' : 'mpk'}`);
    await writeBundleFile({ bundlePath, format, bundle: { file: 'src/fixture.js', optional: undefined,
      chunks: [{ chunkUid: 'fixture', optional: undefined }] } });
    const read = await readBundleFile(bundlePath, { format });
    results.push({ case: `omitted-${format}`, ok: read.ok, reason: read.reason || null });
    if (format === 'json' && read.ok) {
      assert.equal(Object.hasOwn(read.bundle, 'optional'), false);
      assert.equal(Object.hasOwn(read.bundle.chunks[0], 'optional'), false);
    }
  }
  const legacyBuffer = { file: 'legacy.js', chunks: [{ embedding_u8: Buffer.from([4, 5]) }] };
  assert.deepEqual(canonicalizeBundlePayloadForChecksum(legacyBuffer).chunks[0].embedding_u8,
    { type: 'Buffer', data: [4, 5] }, 'the established MessagePack checksum projection stays unchanged');
  const legacyChecksum = await checksumBundlePayloadLocal(legacyBuffer, { maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES });
  const legacyPath = path.join(root, 'legacy-buffer.mpk');
  await fs.writeFile(legacyPath, new Packr({ useRecords: false, structuredClone: true }).pack({
    format: BUNDLE_FORMAT_TAG, version: BUNDLE_VERSION,
    checksum: { schemaVersion: BUNDLE_CHECKSUM_SCHEMA_VERSION, ...legacyChecksum }, payload: legacyBuffer
  }));
  const legacyRead = await readBundleFile(legacyPath, { format: 'msgpack' });
  assert.equal(legacyRead.ok, true, 'an existing Buffer-object MessagePack checksum remains readable');
  assert.deepEqual(Array.from(legacyRead.bundle.chunks[0].embedding_u8), [4, 5]);
  const patchPath = path.join(root, 'patched.json');
  const previousBundle = { file: 'src/fixture.js', chunks: [{ chunkUid: 'fixture', embedding_u8: [0, 0] }] };
  const nextBundle = { ...previousBundle, chunks: [{ chunkUid: 'fixture', embedding_u8: new Uint8Array([9, 8]) }] };
  await writeBundleFile({ bundlePath: patchPath, bundle: previousBundle, format: 'json' });
  const patched = await writeBundlePatch({ bundlePath: patchPath, previousBundle, nextBundle, format: 'json' });
  assert.equal(patched.applied, true);
  const readPatched = await readBundleFile(patchPath, { format: 'json' });
  results.push({ case: 'typed-vector-patch', ok: readPatched.ok, reason: readPatched.reason || null });
  console.log(JSON.stringify(results));
  assert.deepEqual(results.filter((result) => result.ok !== true), [], 'every published representation must match its checksum');
  assert.deepEqual(Array.from(readPatched.bundle.chunks[0].embedding_u8), [9, 8]);
  const descriptorPath = `${patchPath}.checksum.json`;
  const descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  descriptor.checksum.value = 'bad-checksum';
  await fs.writeFile(descriptorPath, JSON.stringify(descriptor));
  assert.equal((await readBundleFile(patchPath, { format: 'json' })).ok, false, 'actual damage remains rejected');
  console.log('JSON/MessagePack byte-vector, omitted-field and typed-patch representations retain verified checksum parity.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
