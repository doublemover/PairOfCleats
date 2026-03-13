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
const jsonBundlePath = path.join(tempRoot, 'bundle.json');
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
    envelope.checksum = { schemaVersion: 2, algo: 'sha512', value: 'cafef00d' };
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
    envelope.checksum = { schemaVersion: 2, algo: 'sha1', value: 'deadbeef' };
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
    envelope.checksum = { schemaVersion: 2, algo: 'xxh64' };
  });
  const invalid = await readBundleFile(bundlePath, { format: 'msgpack' });
  assert.equal(invalid?.ok, false, 'expected invalid checksum envelope to fail closed');
  assert.equal(invalid?.reason, 'invalid bundle checksum');

  await writeBundleFile({
    bundlePath,
    bundle,
    format: 'msgpack'
  });
  await writeTamperedEnvelope((envelope) => {
    envelope.checksum = { schemaVersion: 1, algo: 'xxh64', value: 'cafef00d' };
  });
  const schemaMismatch = await readBundleFile(bundlePath, { format: 'msgpack' });
  assert.equal(schemaMismatch?.ok, false, 'expected unsupported checksum schema to fail closed');
  assert.equal(schemaMismatch?.reason, 'unsupported bundle checksum schema');

  const jsonWrite = await writeBundleFile({
    bundlePath: jsonBundlePath,
    bundle,
    format: 'json'
  });
  assert.equal(typeof jsonWrite?.checksum, 'string', 'expected json bundle checksum sidecar');
  const jsonChecksumPath = `${jsonBundlePath}.checksum.json`;
  const checksumPayload = JSON.parse(await fs.readFile(jsonChecksumPath, 'utf8'));
  checksumPayload.checksum.value = 'deadbeef';
  await fs.writeFile(jsonChecksumPath, `${JSON.stringify(checksumPayload)}\n`, 'utf8');
  const jsonMismatch = await readBundleFile(jsonBundlePath, { format: 'json' });
  assert.equal(jsonMismatch?.ok, false, 'expected json checksum mismatch to fail closed');
  assert.equal(jsonMismatch?.reason, 'bundle checksum mismatch');

  checksumPayload.checksum = { schemaVersion: 2, algo: 'sha512', value: 'abc' };
  await fs.writeFile(jsonChecksumPath, `${JSON.stringify(checksumPayload)}\n`, 'utf8');
  const jsonUnsupported = await readBundleFile(jsonBundlePath, { format: 'json' });
  assert.equal(jsonUnsupported?.ok, false, 'expected json unsupported checksum algo to fail closed');
  assert.equal(jsonUnsupported?.reason, 'unsupported bundle checksum algo');

  checksumPayload.checksumSchemaVersion = 1;
  checksumPayload.checksum = { schemaVersion: 1, algo: 'xxh64', value: jsonWrite.checksum };
  await fs.writeFile(jsonChecksumPath, `${JSON.stringify(checksumPayload)}\n`, 'utf8');
  const jsonSchemaMismatch = await readBundleFile(jsonBundlePath, { format: 'json' });
  assert.equal(jsonSchemaMismatch?.ok, false, 'expected json unsupported checksum schema to fail closed');
  assert.equal(jsonSchemaMismatch?.reason, 'unsupported bundle checksum schema');

  const typedBundle = {
    file: 'src/vector.ts',
    chunks: [{ chunkUid: 'ck:typed:1', embedding_u8: Uint8Array.from([1, 2, 3]) }]
  };
  const typedJsonBundlePath = path.join(tempRoot, 'typed-bundle.json');
  const typedMsgpackBundlePath = path.join(tempRoot, 'typed-bundle.mpk');
  await writeBundleFile({
    bundlePath: typedJsonBundlePath,
    bundle: typedBundle,
    format: 'json'
  });
  await writeBundleFile({
    bundlePath: typedMsgpackBundlePath,
    bundle: typedBundle,
    format: 'msgpack'
  });
  const typedJsonRead = await readBundleFile(typedJsonBundlePath, { format: 'json' });
  const typedMsgpackRead = await readBundleFile(typedMsgpackBundlePath, { format: 'msgpack' });
  assert.equal(typedJsonRead?.ok, true, 'expected typed-array json bundle checksum verification to pass');
  assert.equal(typedMsgpackRead?.ok, true, 'expected typed-array msgpack bundle checksum verification to pass');

  console.log('bundle io checksum fail-closed test passed');
} finally {
  const cleanup = await removePathWithRetry(tempRoot, {
    attempts: 6,
    baseDelayMs: 100,
    maxDelayMs: 100
  });
  if (!cleanup.ok) throw cleanup.error;
}
