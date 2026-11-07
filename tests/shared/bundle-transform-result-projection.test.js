#!/usr/bin/env node
import assert from 'node:assert/strict';
import { BundleTransformOwner, bundleTransformHeapContract } from '../../src/shared/bundle-io/transform-owner.js';
import { checksumBundlePayloadLocal, normalizeBundlePayload } from '../../src/shared/bundle-io-checksum.js';
import { MAX_BUNDLE_CHECKSUM_BYTES } from '../../src/shared/bundle-contract.js';
import { applyTestEnv } from '../helpers/test-env.js';
applyTestEnv({ testing: '1' });
const owner = new BundleTransformOwner();
const bundle = { z: 'λ'.repeat(1500000), a: [1, 2], typed: new Uint32Array([3, 4]) };
try {
  const first = await owner.run({ operation: 'checksum-only', payload: { bundle } });
  if (bundleTransformHeapContract().supported) {
    assert.equal(first.ok, true); assert.deepEqual(Object.keys(first.result), ['checksum']);
    assert.deepEqual(first.result.checksum, await checksumBundlePayloadLocal(normalizeBundlePayload(bundle), { maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES }));
    const second = await owner.run({ operation: 'normalize-checksum', payload: { bundle } });
    assert.deepEqual(second.result.normalized, normalizeBundlePayload(bundle));
    assert.equal(owner.stats().workersStarted, 1, 'explicit session owner reuses one admitted worker');
    assert.ok(owner.stats().estimatedResultBytes < owner.stats().estimatedInputBytes);
    assert.equal(bundle.typed.byteLength, 8, 'borrowed buffers are cloned without detachment');
  } else { assert.equal(first.ok, false); assert.equal(first.reason, 'heap-bound-unavailable'); }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(owner.run({ operation: 'checksum-only', payload: { bundle }, signal: controller.signal }), { code: 'ABORT_ERR' });
} finally { await owner.close(); await owner.close(); }
