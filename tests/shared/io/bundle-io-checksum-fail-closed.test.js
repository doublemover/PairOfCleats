#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Packr, Unpackr } from 'msgpackr';
import { readBundleFile, writeBundleFile } from '../../../src/shared/bundle-io.js';
import { removePathWithRetry } from '../../../src/shared/io/remove-path-with-retry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `bundle-io-checksum-fail-closed-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const packr = new Packr({ useRecords: false, structuredClone: true });
const unpackr = new Unpackr({ useRecords: false });
const bundlePath = path.join(tempRoot, 'bundle.mpk');
const bundle = {
  file: 'src/sample.ts',
  chunks: [{ chunkUid: 'ck:test:1', text: 'export const answer = 42;' }]
};

const writeTamperedEnvelope = async (mutate) => {
  const raw = await fs.readFile(bundlePath);
  const envelope = unpackr.unpack(raw);
  mutate(envelope);
  await fs.writeFile(bundlePath, Buffer.from(packr.pack(envelope)));
};

try {
  await writeBundleFile({
    bundlePath,
    bundle,
    format: 'msgpack'
  });

  await writeTamperedEnvelope((envelope) => {
    envelope.checksum = { algo: 'sha512', value: 'cafef00d' };
  });
  const unsupported = await readBundleFile(bundlePath, { format: 'msgpack' });
  assert.equal(unsupported?.ok, false, 'expected unsupported checksum algo to fail closed');
  assert.equal(unsupported?.reason, 'unsupported bundle checksum algo');

  await writeBundleFile({
    bundlePath,
    bundle,
    format: 'msgpack'
  });
  await writeTamperedEnvelope((envelope) => {
    envelope.checksum = { algo: 'sha1', value: 'deadbeef' };
  });
  const mismatch = await readBundleFile(bundlePath, { format: 'msgpack' });
  assert.equal(mismatch?.ok, false, 'expected checksum mismatch to fail closed');
  assert.equal(mismatch?.reason, 'bundle checksum mismatch');

  await writeBundleFile({
    bundlePath,
    bundle,
    format: 'msgpack'
  });
  await writeTamperedEnvelope((envelope) => {
    envelope.checksum = { algo: 'xxh64' };
  });
  const invalid = await readBundleFile(bundlePath, { format: 'msgpack' });
  assert.equal(invalid?.ok, false, 'expected invalid checksum envelope to fail closed');
  assert.equal(invalid?.reason, 'invalid bundle checksum');

  console.log('bundle io checksum fail-closed test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
