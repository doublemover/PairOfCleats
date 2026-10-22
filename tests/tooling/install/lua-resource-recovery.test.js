import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { gzipSync } from 'node:zlib';
import { installLuaLanguageServer } from '../../../tools/tooling/install-lua-language-server.js';
import { resolveManagedLuaLanguageServer } from '../../../src/shared/managed-lua.js';
import { getArchiveExtractionSession } from '../../../tools/shared/archive-extraction.js';
import { isFileLockPublicationPending } from '../../../src/shared/locks/file-lock.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

// UNVALIDATED: actual shared archive, local input, staged publication and
// metadata owners. Payloads are inert files, never executed.
const root = await makeTempDir('poc-lua-resource-');
const open = fs.open, rm = fs.rm, chmod = fs.chmod;
const handles = [];
const commandName = process.platform === 'win32' ? 'lua-language-server.exe' : 'lua-language-server';
const rejected = async action => {
  let failed = false, error;
  try { await action(); } catch (value) { failed = true; error = value; }
  assert.equal(failed, true); return error;
};
const contains = (value, expected) => {
  const queue = [value], seen = new Set();
  while (queue.length) {
    const current = queue.pop(); if (current === expected) return true;
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current); queue.push(current.cause, ...(Array.isArray(current.errors) ? current.errors : []));
  }
  return false;
};
const complete = async failure => {
  const held = getArchiveExtractionSession(failure); assert.ok(held);
  assert.deepEqual(await held.releaseAfterClose(), { resourceId: held.resourceId, settled: true, pending: false });
};
try {
  const files = [[`bin/${commandName}`, Buffer.from('inert Lua executable bytes')], ['bin/main.lua', Buffer.from('return {}\n')]];
  const zip = new AdmZip(); for (const [name, body] of files) zip.addFile(name, body);
  const archiveBytes = zip.toBuffer();
  const archive = path.join(root, 'lua.zip'); await fs.writeFile(archive, archiveBytes);
  const toolingRoot = path.join(root, 'tooling');
  const args = { scope: 'cache', 'tooling-root': toolingRoot, url: archive, retries: 0 };
  const installed = await installLuaLanguageServer(args);
  const prior = resolveManagedLuaLanguageServer(toolingRoot); assert.ok(prior);
  assert.equal(installed.executablePath, prior.command);
  if (process.platform !== 'win32') {
    assert.notEqual((await fs.stat(prior.command)).mode & 0o111, 0);
    await fs.chmod(prior.command, 0o644);
    assert.equal(resolveManagedLuaLanguageServer(toolingRoot), null, 'missing executable mode cannot qualify an existing selection');
    await fs.chmod(prior.command, 0o755);
  }

  // The Tar.gz path uses the same bounded shared parser and explicit mode rule.
  const pack = tar.pack(); for (const [name, body] of files) pack.entry({ name }, body); pack.finalize();
  const chunks = []; for await (const chunk of pack) chunks.push(chunk);
  const tarArchive = path.join(root, 'lua.tar.gz'); await fs.writeFile(tarArchive, gzipSync(Buffer.concat(chunks)));
  const tarTooling = path.join(root, 'tar-tooling');
  await installLuaLanguageServer({ ...args, 'tooling-root': tarTooling, url: tarArchive });
  assert.ok(resolveManagedLuaLanguageServer(tarTooling));

  const owner = path.join(toolingRoot, 'servers/lua-language-server'), lockPath = path.join(owner, 'install.lock');
  const pointer = path.join(owner, 'current.json'), originalPointer = await fs.readFile(pointer);
  {
    let stage, deny = true, settled = false, removals = 0;
    const primary = Object.freeze(Object.assign(new Error('frozen copy failure'), { cleanupErrors: 'original non-array evidence' }));
    const secondary = Object.freeze(Object.assign(new Error('frozen stage removal owner'), {
      cacheOwnershipPending: false,
      cacheOwnershipReleased() { assert.equal(this, secondary); return settled; }
    }));
    fs.rm = async (file, options) => {
      if (file === stage) { removals += 1; if (deny) throw secondary; }
      return rm(file, options);
    };
    const failure = await rejected(() => installLuaLanguageServer(args, { copy: async (_source, target) => {
      stage = path.dirname(target); throw primary;
    } }));
    assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    assert.equal(primary.cleanupErrors, 'original non-array evidence');
    assert.equal(removals, 1); assert.equal(failure.cacheOwnershipReleased(), false);
    assert.equal((await fs.lstat(stage)).isDirectory(), true);
    assert.equal((await fs.lstat(lockPath)).isFile(), true, 'pending stage cleanup keeps its actual publication lock');
    deny = false;
    await rejected(() => complete(failure));
    assert.equal(removals, 1, 'original independent cleanup observer gates destruction');
    settled = true; await complete(failure);
    assert.equal(removals, 2); assert.equal(failure.cacheOwnershipReleased(), true);
    await assert.rejects(fs.lstat(stage), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(pointer), originalPointer);
    fs.rm = rm;
  }
  for (const value of [undefined, null, false, 0, '']) {
    const failure = await rejected(() => installLuaLanguageServer(args, { copy: () => { throw value; } }));
    assert.equal(failure.cause.cause, value, 'outer owner retains exact falsey staging cause');
    assert.equal(failure.cacheOwnershipReleased(), true);
    assert.deepEqual(await fs.readFile(pointer), originalPointer);
  }
  {
    const originalRecovery = Object.freeze({ earlier: 'preserve on exact cause' });
    const primary = Object.freeze(Object.assign(new Error('frozen post-promotion refusal'), { recovery: originalRecovery }));
    const failure = await rejected(() => installLuaLanguageServer(args, { beforeSelection: () => { throw primary; } }));
    assert.equal(contains(failure, primary), true);
    assert.equal(primary.recovery, originalRecovery);
    assert.equal(failure.recovery.priorGenerationRetained, true);
    assert.equal(failure.recovery.deletionAuthority, false);
    assert.equal((await fs.lstat(failure.recovery.retainedReplacement)).isDirectory(), true);
    assert.deepEqual(await fs.readFile(pointer), originalPointer);
    assert.equal(resolveManagedLuaLanguageServer(toolingRoot).root, prior.root);
  }

  // An actual local input close failure stops retries and never deletes the
  // selected source archive. Explicit recovery closes its original descriptor.
  {
    let allowed = false, opens = 0, closes = 0;
    const original = Object.freeze(Object.assign(new Error('local input close failed'), { retryable: true }));
    fs.open = async (file, ...values) => {
      const handle = await open(file, ...values);
      if (file !== archive) return handle;
      handles.push(handle); opens += 1;
      const owned = {};
      for (const method of ['read', 'write', 'stat']) owned[method] = function (...parts) { assert.equal(this, owned); return handle[method](...parts); };
      owned.close = async function () { assert.equal(this, owned); closes += 1; if (!allowed) throw original; await handle.close(); };
      return owned;
    };
    const failure = await rejected(() => installLuaLanguageServer({ ...args, retries: 4 }));
    assert.equal(contains(failure, original), true); assert.equal(opens, 1); assert.equal(closes, 1);
    assert.equal(failure.cacheOwnershipReleased(), false);
    allowed = true; await complete(failure);
    assert.equal(opens, 1); assert.equal(closes, 2);
    assert.deepEqual(await fs.readFile(archive), archiveBytes);
    fs.open = open;
  }

  // A failed real publication write retains the actual existing lock owner.
  // Nested transaction retry uses its private capability, without reopening or
  // claiming authority from a copied field/cause/PID.
  {
    let opens = 0, closes = 0, copies = 0;
    const original = Object.freeze(new Error('Lua publication write failure'));
    fs.open = async (file, ...values) => {
      const handle = await open(file, ...values);
      if (file !== lockPath) return handle;
      handles.push(handle); opens += 1;
      const owned = {
        stat(options) { assert.equal(this, owned); return handle.stat(options); },
        writeFile() { assert.equal(this, owned); throw original; },
        async close() { assert.equal(this, owned); closes += 1; await handle.close(); }
      };
      return owned;
    };
    const failure = await rejected(() => installLuaLanguageServer(args, { copy() { copies += 1; } }));
    assert.equal(contains(failure, original), true); assert.equal(opens, 1); assert.equal(closes, 1); assert.equal(copies, 0);
    assert.equal(isFileLockPublicationPending(lockPath), true);
    await complete(failure);
    assert.equal(isFileLockPublicationPending(lockPath), false);
    assert.equal(opens, 1); assert.equal(closes, 1);
    assert.deepEqual(await fs.readFile(pointer), originalPointer);
    fs.open = open;
  }
  if (process.platform !== 'win32') {
    const original = Object.freeze(Object.assign(new Error('executable chmod refused'), { code: 'EACCES' }));
    fs.chmod = async (file, mode) => {
      if (path.basename(file) === commandName && mode === 0o755) throw original;
      return chmod(file, mode);
    };
    const failure = await rejected(() => installLuaLanguageServer(args));
    assert.equal(contains(failure, original), true);
    assert.deepEqual(await fs.readFile(pointer), originalPointer);
    fs.chmod = chmod;
    await rejected(() => installLuaLanguageServer(args, { afterValidation: async stage => {
      await fs.chmod(path.join(stage, 'bin', commandName), 0o644);
    } }));
    assert.deepEqual(await fs.readFile(pointer), originalPointer);
  }
} finally {
  fs.open = open; fs.rm = rm; fs.chmod = chmod;
  for (const handle of handles) { try { await handle.close(); } catch {} }
  await rmDirRecursive(root);
}
console.log('Lua archive/stage/selection owners preserve original failures and permission requirements.');
