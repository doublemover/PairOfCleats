#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { probeFileSignature } from '../../src/shared/file-signature.js';

const SIGNATURE_OPTIONS = {
  compressedSiblings: 'never',
  format: 'legacy'
};

const originalStat = fsPromises.stat;

try {
  let nonBigIntStatCalls = 0;
  const mtimeNs = 1700000000123456789n;
  const expectedFromNs = Number(mtimeNs / 1000000n) + Number(mtimeNs % 1000000n) / 1_000_000;
  fsPromises.stat = async (_filePath, options) => {
    if (options?.bigint) {
      return {
        size: 42n,
        mtimeMs: 1700000000123n,
        ctimeMs: 1700000000111n,
        mtimeNs,
        ctimeNs: 1700000000111000000n
      };
    }
    nonBigIntStatCalls += 1;
    return {
      size: 42,
      mtimeMs: 1700000000123.25,
      ctimeMs: 1700000000111.25
    };
  };
  const nsSignature = await probeFileSignature('virtual-file', SIGNATURE_OPTIONS);
  const [nsSize, nsMtimeRaw] = String(nsSignature).split(':');
  assert.equal(nsSize, '42', 'legacy signature should preserve bigint size');
  assert.equal(Number(nsMtimeRaw), expectedFromNs, 'legacy signature should preserve mtimeNs precision');
  assert.notEqual(
    Number(nsMtimeRaw),
    1700000000123,
    'legacy signature should differ from coarse bigint mtimeMs when mtimeNs has sub-ms precision'
  );
  assert.equal(nonBigIntStatCalls, 0, 'mtimeNs precision should avoid fallback non-bigint stat calls');

  nonBigIntStatCalls = 0;
  fsPromises.stat = async (_filePath, options) => {
    if (options?.bigint) {
      return {
        size: 11n,
        mtimeMs: 9n,
        ctimeMs: 9n
      };
    }
    nonBigIntStatCalls += 1;
    return {
      size: 11,
      mtimeMs: 9.75,
      ctimeMs: 9.5
    };
  };
  const fallbackSignature = await probeFileSignature('virtual-file', SIGNATURE_OPTIONS);
  const [fallbackSize, fallbackMtimeRaw] = String(fallbackSignature).split(':');
  assert.equal(fallbackSize, '11', 'legacy signature should preserve bigint size in fallback path');
  assert.equal(Number(fallbackMtimeRaw), 9.75, 'legacy signature should use non-bigint mtimeMs fallback precision');
  assert.equal(nonBigIntStatCalls, 1, 'legacy fallback should stat once without bigint when mtimeNs is unavailable');
} finally {
  fsPromises.stat = originalStat;
}

console.log('shared file signature legacy mtime precision unit test passed');
