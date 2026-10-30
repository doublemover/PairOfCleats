import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { readJsonFile, readJsonLinesArraySync, readJsonLinesIterator } from '../../../src/shared/artifact-io/json.js';
import { readBuffer, collectCompressedCandidates } from '../../../src/shared/artifact-io/compression.js';
import { isMissingReadError, captureFallbackReadError } from '../../../src/shared/artifact-io/json/fallback.js';
import { getContainedFileSession } from '../../../src/shared/contained-file-resource.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual small JSON/JSONL consumers, disposable sources/backups and
// bounded-read owner faults. Stream destruction/large native decompression are separate.
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (current === null || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current, 'cause')) queue.push(current.cause);
    if (Array.isArray(current.errors)) queue.push(...current.errors);
  }
  return false;
};
const root = await makeTempDir('poc-artifact-fallback-resource-');
const originalStat = fs.statSync, originalReadFile = fs.readFileSync;
const originalOpen = fs.openSync, originalClose = fs.closeSync;
const disposal = new Set();
const restore = () => { fs.statSync = originalStat; fs.readFileSync = originalReadFile; fs.openSync = originalOpen; fs.closeSync = originalClose; };
try {
  let sequence = 0;
  const readers = [
    { extension: '.json', read: (target, options) => readJsonFile(target, options), result: { id: 2 } },
    { extension: '.jsonl', read: (target, options) => readJsonLinesArraySync(target, { requiredKeys: ['id'], ...options }), result: [{ id: 2 }] },
    { extension: '.jsonl', read: async (target, options) => {
      const rows = []; for await (const row of readJsonLinesIterator(target, { requiredKeys: ['id'], ...options })) rows.push(row); return rows;
    }, result: [{ id: 2 }] }
  ];
  const makeFiles = async reader => {
    const target = path.join(root, `source-${sequence++}${reader.extension}`), backup = `${target}.bak`;
    await fsp.writeFile(target, '{"id":1}\n'); await fsp.writeFile(backup, '{"id":2}\n');
    return { target, backup };
  };
  const fault = ({ target, backup }, primary) => {
    const state = { backups: 0 };
    fs.statSync = (file, ...args) => { if (file === target) throw primary; return originalStat(file, ...args); };
    fs.readFileSync = (file, ...args) => { if (file === backup) state.backups += 1; return originalReadFile(file, ...args); };
    return state;
  };
  for (const reader of readers) {
    for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('frozen original artifact read failure'))]) {
      const files = await makeFiles(reader), state = fault(files, primary);
      const failure = await rejected(() => reader.read(files.target, {}));
      assert.equal(contains(failure, primary), true); assert.equal(state.backups, 0, 'falsey caught failure is not the no-primary sentinel');
      restore();
    }
    for (const recoveryFallback of [false, true]) {
      const files = await makeFiles(reader); let settled = false;
      const primary = Object.assign(new Error('missing-shaped artifact failure with independent native work'), {
        code: 'ENOENT', cacheOwnershipPending: false,
        cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      const state = fault(files, primary);
      const failure = await rejected(() => reader.read(files.target, { recoveryFallback }));
      assert.equal(contains(failure, primary), true); assert.equal(state.backups, 0);
      primary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
    }
    {
      const files = await makeFiles(reader); let settled = true, inspections = 0;
      const primary = Object.assign(new Error('diagnostic getter changes original native observation'), {
        cacheOwnershipReleased() { assert.equal(this, primary); return settled; }
      });
      Object.defineProperty(primary, 'code', { get() {
        assert.equal(this, primary); inspections += 1; settled = false; primary.cacheOwnershipReleased = () => true; return 'ENOENT';
      } });
      const state = fault(files, primary), failure = await rejected(() => reader.read(files.target, {}));
      assert.equal(state.backups, 0); assert.equal(inspections, 1); assert.equal(failure.cacheOwnershipReleased(), false);
      await rejected(() => isMissingReadError(primary)); assert.equal(inspections, 1, 'do not reread a replacement diagnostic after failed original observation'); restore();
    }
    for (const secondary of [undefined, null, false, 0, '', Object.freeze(new Error('independent diagnostic inspection failure'))]) {
      const files = await makeFiles(reader); let inspections = 0;
      const primary = Object.freeze(Object.defineProperty(new Error('readonly original code getter'), 'code', {
        get() { assert.equal(this, primary); inspections += 1; throw secondary; }
      }));
      const state = fault(files, primary), failure = await rejected(() => reader.read(files.target, {}));
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
      assert.equal(state.backups, 0); assert.equal(inspections, 1);
      await rejected(() => isMissingReadError(primary)); assert.equal(inspections, 1); restore();
    }
    {
      const files = await makeFiles(reader); let settled = false;
      const secondary = Object.assign(new Error('diagnostic inspection owns independent original native work'), {
        cacheOwnershipPending: false, cacheOwnershipReleased() { assert.equal(this, secondary); return settled; }
      });
      const primary = Object.freeze(Object.defineProperty(new Error('original readonly code getter'), 'code', {
        get() { assert.equal(this, primary); throw secondary; }
      }));
      const state = fault(files, primary), failure = await rejected(() => reader.read(files.target, {}));
      assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true); assert.equal(state.backups, 0);
      secondary.cacheOwnershipReleased = () => true; assert.equal(failure.cacheOwnershipReleased(), false);
      settled = true; assert.equal(failure.cacheOwnershipReleased(), true); restore();
    }
    {
      const files = await makeFiles(reader), state = fault(files, false);
      assert.deepEqual(await reader.read(files.target, { recoveryFallback: true }), reader.result);
      assert.equal(state.backups, 1, 'ordinary settled failure retains explicit recovery fallback'); restore();
    }
    {
      const files = await makeFiles(reader), primary = Object.assign(new Error('ordinary missing source'), { code: 'ENOENT' });
      const state = fault(files, primary);
      assert.deepEqual(await reader.read(files.target, {}), reader.result); assert.equal(state.backups, 1); restore();
    }
  }
  {
    const target = path.join(root, 'candidate.json'), candidate = `${target}.gz`;
    await fsp.writeFile(candidate, 'inert candidate must not be admitted while its stat owner is pending');
    const primary = Object.assign(new Error('candidate stat has original native work'), {
      cacheOwnershipReleased() { assert.equal(this, primary); return false; }
    });
    fs.statSync = (file, ...args) => { if (file === candidate) throw primary; return originalStat(file, ...args); };
    assert.equal(contains(await rejected(() => collectCompressedCandidates(target)), primary), true); restore();
    const earlier = new Error('earlier ordinary fallback error');
    assert.equal(contains(await rejected(() => captureFallbackReadError(earlier, primary)), primary), true,
      'a pending later candidate cannot be dropped merely because an earlier error is already preferred');
  }
  {
    const target = path.join(root, 'retained.json'), backup = `${target}.bak`;
    await fsp.writeFile(target, '{"id":1}'); await fsp.writeFile(backup, '{"id":2}');
    let fd, closes = 0, backups = 0;
    const secondary = Object.freeze(new Error('size admission plus independent exact close failure'));
    fs.openSync = (file, ...args) => { const actual = originalOpen(file, ...args); if (file === target) { fd = actual; disposal.add(actual); } return actual; };
    fs.closeSync = actual => { if (actual === fd) { closes += 1; throw secondary; } return originalClose(actual); };
    fs.readFileSync = (file, ...args) => { if (file === backup) backups += 1; return originalReadFile(file, ...args); };
    const failure = await rejected(() => readJsonFile(target, { maxBytes: 1, containedRoot: root, recoveryFallback: true }));
    const session = getContainedFileSession(failure);
    assert.ok(session); assert.equal(failure.code, 'ERR_FILE_TOO_LARGE'); assert.equal(contains(failure, secondary), true);
    assert.equal(closes, 1); assert.equal(backups, 0, 'retained descriptor cannot become a remapped size error or backup admission');
    await rejected(() => session.releaseAfterCloseSync()); assert.equal(closes, 1);
    originalClose(fd); disposal.delete(fd); assert.equal(session.isSettled(), false); restore();
    const ordinary = await rejected(() => readBuffer(target, 1, { containedRoot: root }));
    assert.equal(ordinary.code, 'ERR_JSON_TOO_LARGE'); assert.equal(getContainedFileSession(ordinary), null);
    assert.equal(contains(ordinary, null), false); assert.equal(ordinary.cacheOwnershipReleased(), true);
    assert.equal(ordinary.errors[1].code, 'ERR_FILE_TOO_LARGE');
  }
} finally {
  restore(); for (const fd of disposal) { try { originalClose(fd); } catch {} }
  await rmDirRecursive(root);
}
console.log('artifact-fallback-resource-failures passed');
