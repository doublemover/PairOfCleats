import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { installPublicationBoundaryDiagnostics } from '../helpers/publication-boundary-diagnostics.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
// The hook still wraps the canonical owner below; module initialization is
// outside the two original descriptor operations being counted.
await import('../../src/index/build/stage-output.js');
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('runner/publication-diagnostic-ownership/')[1];
assert.ok(['boundary', 'io'].includes(mode));
const { dir } = await prepareIsolatedTestCacheDir('publication-diagnostic-' + mode);
const identity = await fsp.lstat(dir, { bigint: true });
const bytes = Buffer.from('{"value":42}\n');
await fsp.writeFile(path.join(dir, 'good.json'), bytes); await fsp.writeFile(path.join(dir, 'fail.json'), bytes);
const original = { open: fsp.open, statSync: fs.statSync, lstatSync: fs.lstatSync, fstatSync: fs.fstatSync, log: console.log };
const failure = Object.freeze(new Error('original opened-descriptor read failed'));
const calls = { open: 0, read: 0, close: 0, readFailure: 0 }, events = [];
const observedOpen = async function(...args) {
  calls.open++; const handle = await Reflect.apply(original.open, this, args), read = handle.read, close = handle.close;
  handle.read = async function(...input) {
    assert.equal(this, handle); calls.read++;
    if (path.basename(args[0]) === 'fail.json') { calls.readFailure++; throw failure; }
    return Reflect.apply(read, this, input);
  };
  handle.close = async function(...input) { assert.equal(this, handle); calls.close++; return Reflect.apply(close, this, input); };
  return handle;
};
const contains = (value, target, seen = new Set()) => {
  if (value === target) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.hasOwn(value, 'cause') && contains(value.cause, target, seen)
    || Array.isArray(value.errors) && value.errors.some(error => contains(error, target, seen));
};
let diagnostics;
fsp.open = observedOpen;
console.log = line => { assert.ok(events.length < 32); events.push(JSON.parse(line)); };
try {
  diagnostics = mode === 'io' ? installPublicationBoundaryDiagnostics({ instrumentIo: true }) : installPublicationBoundaryDiagnostics();
  if (mode === 'boundary') {
    assert.equal(fsp.open, observedOpen); assert.equal(fs.statSync, original.statSync); assert.equal(fs.lstatSync, original.lstatSync);
    assert.equal(fs.fstatSync, original.fstatSync);
  } else { assert.notEqual(fsp.open, observedOpen); assert.notEqual(fs.statSync, original.statSync); }
  const { readBuildMetadata } = await import('../../src/index/build/stage-output.js');
  const result = await readBuildMetadata(dir, path.join(dir, 'good.json'));
  assert.deepEqual(result.value, { value: 42 }); assert.equal(result.hash, createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(readBuildMetadata(dir, path.join(dir, 'fail.json')), error => contains(error, failure));
  diagnostics.finish();
  assert.equal(fsp.open, observedOpen); assert.equal(fs.statSync, original.statSync); assert.equal(fs.lstatSync, original.lstatSync);
  assert.equal(fs.fstatSync, original.fstatSync);
  assert.equal(calls.open, 2); assert.equal(calls.close, 2); assert.equal(calls.readFailure, 1);
  const finished = events.find(event => event.phase === 'publication-diagnostics-finished');
  assert.equal(finished.instrumentedIo, mode === 'io');
  assert.equal(events.filter(event => event.phase === 'publication-boundary-start').length, 2);
  assert.deepEqual(events.filter(event => event.phase === 'publication-boundary-settled').map(event => event.failed), [false, true]);
  if (mode === 'io') {
    assert.equal(finished.activeIoOperations, 0);
    for (const operation of ['open', 'read', 'close']) {
      const counters = finished.counters.filter(counter => counter.operation === operation);
      assert.equal(counters.reduce((sum, counter) => sum + counter.calls, 0), calls[operation]);
    }
    assert.equal(finished.counters.filter(counter => counter.operation === 'read').reduce((sum, counter) => sum + counter.failures, 0), 1);
    assert.ok(finished.counters.some(counter => counter.operation === 'fstatSync' && counter.calls > 0));
  } else {
    assert.equal(finished.activeIoOperations, null); assert.equal(finished.counters, null);
    assert.equal(events.filter(event => event.phase === 'publication-io-observed').length, 0);
  }
} finally {
  diagnostics?.finish(); fsp.open = original.open; fs.statSync = original.statSync; fs.lstatSync = original.lstatSync; fs.fstatSync = original.fstatSync; console.log = original.log;
  const current = await fsp.lstat(dir, { bigint: true });
  assert.ok(current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino);
  assert.ok(path.relative(process.cwd(), dir).startsWith('.tmp' + path.sep)); await fsp.rm(dir, { recursive: true, force: false });
}
console.log('Original metadata reads, failure identity, confirmed close and filesystem restoration survive ' + mode + ' diagnostics.');
