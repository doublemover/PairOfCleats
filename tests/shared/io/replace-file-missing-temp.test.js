#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { replaceFile, replaceFileSync } from '../../../src/shared/io/replace-file.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-replace-missing-'));
try {
  for (const sync of [false, true]) {
    const final = path.join(root, `final-${sync}`), temp = path.join(root, `temp-${sync}`);
    await fsp.writeFile(final, 'old unrelated authority');
    if (sync) assert.throws(() => replaceFileSync(temp, final), { code: 'ERR_TEMP_MISSING' });
    else await assert.rejects(replaceFile(temp, final), { code: 'ERR_TEMP_MISSING' });
    assert.equal(await fsp.readFile(final, 'utf8'), 'old unrelated authority');
    await fsp.writeFile(temp, 'new authority');
    const rename = sync ? fs.renameSync : fsp.rename;
    const concurrentRename = (from, to) => {
      fs.renameSync = sync ? rename : fs.renameSync;
      fs.renameSync(from, to);
      throw Object.assign(new Error('another writer consumed the same source'), { code: 'ENOENT' });
    };
    try {
      if (sync) { fs.renameSync = concurrentRename; replaceFileSync(temp, final); }
      else { fsp.rename = async (from, to) => concurrentRename(from, to); await replaceFile(temp, final); }
    } finally {
      if (sync) fs.renameSync = rename;
      else fsp.rename = rename;
    }
    assert.equal(await fsp.readFile(final, 'utf8'), 'new authority');
  }
} finally { await fsp.rm(root, { recursive: true, force: true }); }
console.log('file replacement requires exact promoted source identity');
