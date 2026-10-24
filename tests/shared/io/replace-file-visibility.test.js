#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode as runNodeFixture } from '../../helpers/run-node.js';
import { replaceFile, replaceFileSync } from '../../../src/shared/io/replace-file.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-replace-visibility-'));
try {
  const publishedDuringWait = path.join(root, 'concurrent.json');
  const publisher = setTimeout(() => fs.writeFileSync(publishedDuringWait, '{"version":1}'), 20);
  try {
    await assert.rejects(replaceFile(path.join(root, 'already-consumed.tmp'), publishedDuringWait),
      { code: 'ERR_TEMP_MISSING' });
    assert.deepEqual(JSON.parse(await fsp.readFile(publishedDuringWait, 'utf8')), { version: 1 },
      'an unrelated concurrent publication cannot prove a missing source was promoted');
  } finally { clearTimeout(publisher); }
  for (const sync of [false, true]) {
    for (const keepBackup of [false, true]) {
      const final = path.join(root, 'target.json'), temp = path.join(root, 'temp.json');
      const old = JSON.stringify({ version: 1, payload: 'old'.repeat(100) });
      const next = JSON.stringify({ version: 2, payload: 'new'.repeat(100) });
      await fsp.writeFile(final, old); await fsp.writeFile(temp, next);
      const original = sync ? fs.renameSync : fsp.rename;
      const observed = [];
      const observe = () => {
        const visible = fs.readFileSync(final, 'utf8');
        assert.ok(visible === old || visible === next, 'every publication boundary exposes a complete old or new target');
        observed.push(visible);
      };
      try {
        if (sync) {
          fs.renameSync = (...args) => { observe(); const result = original(...args); observe(); return result; };
          replaceFileSync(temp, final, { keepBackup });
        } else {
          fsp.rename = async (...args) => { observe(); const result = await original(...args); observe(); return result; };
          await replaceFile(temp, final, { keepBackup });
        }
      } finally {
        if (sync) fs.renameSync = original; else fsp.rename = original;
      }
      assert.deepEqual(observed, [old, next], 'normal replacement has one atomic commit boundary');
      assert.equal(await fsp.readFile(final, 'utf8'), next);
      const backups = (await fsp.readdir(root)).filter(name => name.startsWith('.target.json.bak-'));
      assert.equal(backups.length, keepBackup ? 1 : 0);
      if (keepBackup) {
        assert.equal(await fsp.readFile(path.join(root, backups[0]), 'utf8'), old);
        await fsp.unlink(path.join(root, backups[0]));
      }
    }
  }
  for (const sync of [false, true]) {
    for (const failure of [null, 'copy', 'commit']) {
      const final = path.join(root, 'cross-device.json'), temp = path.join(root, 'cross-device.tmp');
      await fsp.writeFile(final, 'old'); await fsp.writeFile(temp, 'new');
      const rename = sync ? fs.renameSync : fsp.rename, copy = sync ? fs.copyFileSync : fsp.copyFile;
      let fallbackCount = 0;
      const beforeRename = from => {
        assert.equal(fs.readFileSync(final, 'utf8'), 'old');
        if (from === temp) throw Object.assign(new Error('different volume'), { code: 'EXDEV' });
        assert.equal(path.dirname(from), path.dirname(final), 'fallback commit must remain on the target filesystem');
        if (failure === 'commit') throw Object.assign(new Error('blocked commit'), { code: 'EACCES' });
      };
      const beforeCopy = (from, to) => {
        assert.notEqual(to, final, 'a copy must never write into the visible target');
        if (from === temp) {
          assert.equal(fs.readFileSync(final, 'utf8'), 'old');
          if (failure === 'copy') {
            // This hook creates the partial before the original copy acquires
            // its destination. It is unknown ownership, not a sealed copy.
            fs.writeFileSync(to, 'partial');
            throw Object.assign(new Error('copy interrupted'), { code: 'EIO' });
          }
        }
      };
      try {
        const options = { keepBackup: true, onExdevFallback: () => { fallbackCount++; } };
        if (sync) {
          fs.renameSync = (from, to) => { beforeRename(from); return rename(from, to); };
          fs.copyFileSync = (from, to, ...args) => { beforeCopy(from, to); return copy(from, to, ...args); };
          if (failure) assert.throws(() => replaceFileSync(temp, final, options), { code: failure === 'copy' ? 'EIO' : 'EACCES' });
          else replaceFileSync(temp, final, options);
        } else {
          fsp.rename = async (from, to) => { beforeRename(from); return rename(from, to); };
          fsp.copyFile = async (from, to, ...args) => { beforeCopy(from, to); return copy(from, to, ...args); };
          if (failure) await assert.rejects(replaceFile(temp, final, options), { code: failure === 'copy' ? 'EIO' : 'EACCES' });
          else await replaceFile(temp, final, options);
        }
      } finally {
        if (sync) { fs.renameSync = rename; fs.copyFileSync = copy; }
        else { fsp.rename = rename; fsp.copyFile = copy; }
      }
      assert.equal(await fsp.readFile(final, 'utf8'), failure ? 'old' : 'new');
      assert.equal(fs.existsSync(temp), !!failure);
      assert.equal(fallbackCount, failure ? 0 : 1);
      const remaining = (await fsp.readdir(root)).filter(name => name.startsWith('.cross-device.json.bak-'));
      assert.equal(remaining.length, failure === 'commit' ? 0 : 1,
        'sealed failed staging is cleaned; unsealed partial evidence and successful retained backup are preserved');
      for (const name of remaining) {
        assert.equal(await fsp.readFile(path.join(root, name), 'utf8'), failure === 'copy' ? 'partial' : 'old');
        await fsp.unlink(path.join(root, name));
      }
    }
  }
  for (const sync of [false, true]) {
    for (const keepBackup of [false, true]) {
      for (const boundary of ['before', 'after']) {
        const final = path.join(root, 'crash.json'), temp = path.join(root, 'crash.tmp');
        await fsp.writeFile(final, '{"version":1}'); await fsp.writeFile(temp, '{"version":2}');
        const child = runNodeFixture(['--input-type=module', '-e', `
          import fs from 'node:fs'; import fsp from 'node:fs/promises';
          import { replaceFile, replaceFileSync } from ${JSON.stringify(new URL('../../../src/shared/io/replace-file.js', import.meta.url).href)};
          const final = ${JSON.stringify(final)}, temp = ${JSON.stringify(temp)};
          const original = ${sync ? 'fs.renameSync' : 'fsp.rename'};
          const exit = () => process.exit(23);
          ${sync ? 'fs.renameSync = (...args) => {' : 'fsp.rename = async (...args) => {'}
            if (${JSON.stringify(boundary)} === 'before') exit();
            const result = ${sync ? '' : 'await '}original(...args);
            exit(); return result;
          };
          ${sync ? '' : 'await '} ${sync ? 'replaceFileSync' : 'replaceFile'}(temp, final, { keepBackup: ${keepBackup} });
        `], 'isolated Node fixture', process.cwd(), process.env, { allowFailure: true, spawnOptions: { encoding: 'utf8', timeout: 5000 } });
        assert.equal(child.status, 23, child.stderr || child.error?.message);
        assert.deepEqual(JSON.parse(await fsp.readFile(final, 'utf8')),
          { version: boundary === 'before' ? 1 : 2 }, 'abrupt process exit never strands the authoritative target');
      }
    }
  }
} finally {
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('async/sync file replacement preserves atomic visibility with and without retained backups');
