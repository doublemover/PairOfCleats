import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, readJsonFileResolved } from '../../src/shared/json-file.js';
import { getContainedFileSession } from '../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

// UNVALIDATED: strict shared JSON consumer, original reviver and failed FD.
const root = await makeTempDir('poc-json-file-resource-'), file = path.join(root, 'data.json');
await fs.writeFile(file, '{"value":4}');
const open = fs.open, disposal = new Map();
const rejected = async action => {
  let failed = false, failure;
  try { await action(); } catch (value) { failed = true; failure = value; }
  assert.equal(failed, true); return failure;
};
try {
  for (const resolved of [false, true]) {
    let allow = false, reads = 0, closes = 0, roots = 0, opened = 0;
    const primary = Object.freeze(new Error('strict JSON descriptor close failed'));
    fs.open = async (name, ...args) => {
      const actual = await open(name, ...args); if (name !== file) return actual;
      const close = actual.close, read = actual.read; opened += 1; disposal.set(actual, () => close.call(actual));
      actual.read = function (...next) { assert.equal(this, actual); reads += 1; return read.call(actual, ...next); };
      actual.close = function () {
        assert.equal(this, actual); closes += 1; if (!allow) throw primary;
        disposal.delete(actual); return close.call(actual);
      };
      return actual;
    };
    const reviver = function (key, value) { if (key === '') { roots += 1; assert.equal(this[''], value); } return value; };
    const read = () => resolved ? readJsonFileResolved(file) : readJsonFile(file, { reviver });
    const failure = await rejected(read), session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(roots, 0); assert.equal(reads, 1); assert.equal(closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), false); allow = true;
    await session.releaseAfterClose(); assert.equal(reads, 1); assert.equal(roots, 0); assert.equal(closes, 2);
    assert.deepEqual(await read(), { value: 4 }); assert.equal(opened, 2); assert.equal(roots, resolved ? 0 : 1);
    fs.open = open;
  }
  for (const value of [0, false, '', null]) {
    await fs.writeFile(file, JSON.stringify(value));
    assert.equal(await readJsonFile(file), value); assert.equal(await readJsonFileResolved(file), value);
  }
  await fs.writeFile(file, '{"value":4}');
  const primary = Object.freeze(new Error('reviver rejected after descriptor closure')); let active = 0;
  fs.open = async (name, ...args) => {
    const actual = await open(name, ...args); if (name !== file) return actual;
    active += 1; const close = actual.close;
    actual.close = async function () { const result = await close.call(actual); active -= 1; return result; };
    return actual;
  };
  assert.equal(await rejected(() => readJsonFile(file, { reviver() { assert.equal(active, 0); throw primary; } })), primary);
  assert.equal(active, 0); fs.open = open;
  await fs.writeFile(file, '{broken');
  const malformed = await rejected(() => readJsonFileResolved(file)); assert.ok(malformed instanceof SyntaxError);
  assert.equal(getContainedFileSession(malformed), null);
} finally {
  fs.open = open; for (const close of disposal.values()) { try { await close(); } catch {} }
  await rmDirRecursive(root);
}
