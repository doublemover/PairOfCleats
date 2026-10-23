import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { writeJsonArrayFile } from '../../../src/shared/json-stream/json-writers.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import { createJsonlBatchWriter } from '../../../src/shared/json-stream/jsonl-batch.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-json-output-finalizers-'));
const nativeCreate = fsSync.createWriteStream;
let files = [], writeFailure = null, closeFailure = null;
const contains = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length) {
    const value = pending.pop(); if (value === expected) return true;
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value); pending.push(value.cause, ...(Array.isArray(value.errors) ? value.errors : []));
  }
  return false;
};
fsSync.createWriteStream = function (...args) {
  const stream = nativeCreate.apply(this, args);
  files.push(stream);
  if (writeFailure) {
    const injected = writeFailure;
    stream._write = (_chunk, _encoding, callback) => callback(injected);
    stream._writev = (_chunks, callback) => callback(injected);
  }
  if (closeFailure) {
    const injected = closeFailure, destroy = stream._destroy;
    stream._destroy = function (error, callback) {
      destroy.call(this, error, failure => callback(failure && failure !== error ? failure : injected));
    };
  }
  return stream;
};
const closed = () => {
  assert.ok(files.length > 0);
  for (const file of files) { assert.equal(file.destroyed, true); assert.equal(file.closed, true); }
};
try {
  for (const compression of [null, 'gzip']) {
    const target = path.join(root, `late-${compression || 'plain'}.json`);
    await fs.writeFile(target, 'old authority'); files = [];
    writeFailure = Object.freeze(new Error('destination failed while source waited'));
    const rows = (async function* () {
      await setImmediate();
      await setImmediate();
      yield { text: '雪😀'.repeat(100000) };
    })();
    await assert.rejects(writeJsonArrayFile(target, rows, { atomic: true, compression }), error => contains(error, writeFailure));
    closed(); assert.equal(await fs.readFile(target, 'utf8'), 'old authority');
    writeFailure = null;
  }
  for (const jsonl of [false, true]) {
    const target = path.join(root, jsonl ? 'source.jsonl' : 'source.json');
    await fs.writeFile(target, 'old authority'); files = [];
    const primary = Object.freeze(new Error('producer failed'));
    closeFailure = Object.freeze(new Error('independent descriptor close failed'));
    const rows = (async function* () { throw primary; })();
    await assert.rejects(jsonl ? writeJsonLinesFile(target, rows, { atomic: true })
      : writeJsonArrayFile(target, rows, { atomic: true }), error => contains(error, primary) && contains(error, closeFailure));
    closed(); assert.equal(await fs.readFile(target, 'utf8'), 'old authority');
    closeFailure = null;
  }
  const target = path.join(root, 'constructor.json');
  await fs.writeFile(target, 'old authority'); files = [];
  closeFailure = Object.freeze(new Error('constructor rollback descriptor close failed'));
  await assert.rejects(writeJsonArrayFile(target, [], { atomic: true,
    additionalOutputs: [{ filePath: path.join(root, 'unsupported.json'), compression: 'unsupported', atomic: true }] }),
  error => contains(error, closeFailure) && /Unsupported JSON stream compression/.test(error.message));
  closed(); assert.equal(await fs.readFile(target, 'utf8'), 'old authority');
  files = [];
  const primary = Object.freeze(new Error('batch cancelled'));
  const batch = createJsonlBatchWriter(path.join(root, 'batch.jsonl'), { atomic: true });
  await batch.writeLine('{"id":1}');
  await assert.rejects(batch.destroy(primary), error => contains(error, primary) && contains(error, closeFailure));
  closed(); closeFailure = null;
  const admissionPath = path.join(root, 'admission.jsonl'); await fs.writeFile(admissionPath, 'old authority');
  const nativeTruncate = fsSync.ftruncateSync, nativeClose = fsSync.closeSync;
  const truncateFailure = Object.freeze(Object.assign(new Error('preallocation failed'), { code: 'EIO' }));
  const admissionCloseFailure = Object.freeze(new Error('original admission close failed'));
  let rejectClose = false, admissionFd = null, admissionCloses = 0, admissionError;
  fsSync.ftruncateSync = fd => { admissionFd = fd; throw truncateFailure; };
  fsSync.closeSync = function (fd) {
    if (fd === admissionFd) { admissionCloses++; if (rejectClose) { rejectClose = false; throw admissionCloseFailure; } }
    return nativeClose.call(this, fd);
  };
  try {
    const before = (await fs.readdir(root)).sort();
    assert.throws(() => createJsonlBatchWriter(admissionPath, { atomic: true, preallocateBytes: 65536 }),
      error => contains(error, truncateFailure));
    assert.deepEqual((await fs.readdir(root)).sort(), before, 'confirmed admission close permits removal of only the private new file');
    assert.equal(await fs.readFile(admissionPath, 'utf8'), 'old authority');
    rejectClose = true;
    assert.throws(() => createJsonlBatchWriter(admissionPath, { atomic: true, preallocateBytes: 65536 }), error => {
      admissionError = error;
      return contains(error, truncateFailure) && contains(error, admissionCloseFailure) && error.cacheOwnershipPending === true;
    });
    assert.ok(fsSync.fstatSync(admissionFd).isFile(), 'failed original close keeps that exact descriptor open');
    const session = getContainedFileSession(admissionError); assert.ok(session);
    await session.releaseAfterCloseSync();
    assert.equal(session.isSettled(), true);
    assert.throws(() => fsSync.fstatSync(admissionFd), { code: 'EBADF' });
    assert.equal(admissionCloses, 3, 'one ordinary close, one failed close and one explicit original-owner recovery');
    assert.equal(await fs.readFile(admissionPath, 'utf8'), 'old authority');
  } finally {
    if (admissionError) {
      const session = getContainedFileSession(admissionError);
      if (session && !session.isSettled()) await session.releaseAfterCloseSync();
    }
    fsSync.ftruncateSync = nativeTruncate; fsSync.closeSync = nativeClose;
  }
} finally { fsSync.createWriteStream = nativeCreate; await fs.rm(root, { recursive: true, force: true }); }
console.log('JSON writers observe early destination failure and join real descriptor finalizers without losing independent errors.');
