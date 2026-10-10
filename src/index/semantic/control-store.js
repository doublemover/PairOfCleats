import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { acquireFileLock, isProcessAlive } from '../../shared/locks/file-lock.js';
import { syncParentDirectory } from '../../shared/io/persistence-helpers.js';
import { writeSemanticJson } from './disk-writes.js';
import { openSemanticFrontier } from './frontier.js';

const fail = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_CONTROL_REPAIR' });
const checkHeader = async filename => {
  let handle;
  try {
    handle = await fs.open(filename, 'r');
    const header = Buffer.alloc(16), { bytesRead } = await handle.read(header, 0, 16, 0);
    // Detect an invalid main header before SQLite can clean up its sidecars.
    // A zero-length file is SQLite's valid not-yet-initialized state.
    if (bytesRead && (bytesRead !== 16 || header.toString() !== 'SQLite format 3\0')) {
      throw Object.assign(new Error('Invalid semantic control header.'), { code: 'SQLITE_NOTADB' });
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { await handle?.close(); }
};
const digest = async filename => {
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw fail('Control recovery requires regular owned files.');
    const hash = createHash('sha256');
    for await (const bytes of fsSync.createReadStream(filename)) hash.update(bytes);
    return hash.digest('hex');
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
const assertNoClients = async directory => {
  for (const name of await fs.readdir(directory)) {
    if (!/^\.client-[a-f0-9-]+\.json$/.test(name)) continue;
    const filename = path.join(directory, name);
    if ((await fs.lstat(filename)).size > 4096) throw fail('Invalid semantic control client marker.');
    const owner = JSON.parse(await fs.readFile(filename, 'utf8'));
    if (owner.hostname !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || isProcessAlive(owner.pid)) {
      throw fail('Cannot repair semantic control store while a client may be active.');
    }
    await fs.unlink(filename);
  }
};

/** Resume only a checksum-pinned, fully built replacement. Each rename is
 * idempotent; original main/journal bytes remain in the quarantine directory.
 */
const finishRepair = async ({ directory, intentPath, diskAccount }) => {
  let intent;
  try {
    const stat = await fs.lstat(intentPath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16384) throw fail('Invalid control repair intent file.');
    intent = JSON.parse(await fs.readFile(intentPath, 'utf8'));
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (intent.version !== 1 || !/^\.repair-[a-f0-9-]+\.sqlite$/.test(intent.replacement)
    || !/^\.corrupt-[a-f0-9-]+$/.test(intent.quarantine) || !/^[a-f0-9]{64}$/.test(intent.hash)
    || !Array.isArray(intent.originals) || !intent.originals.length || intent.originals.length > 4
    || new Set(intent.originals.map(row => row.name)).size !== intent.originals.length
    || !intent.originals.some(row => row.name === 'control.sqlite')
    || intent.originals.some(row => !/^control\.sqlite(?:-journal|-wal|-shm)?$/.test(row.name) || !/^[a-f0-9]{64}$/.test(row.hash))) {
    throw fail('Invalid semantic control repair intent.');
  }
  await assertNoClients(directory);
  const quarantine = path.join(directory, intent.quarantine);
  await fs.mkdir(quarantine, { recursive: true });
  if ((await fs.lstat(quarantine)).isSymbolicLink()) throw fail('Control quarantine cannot be a link.');
  const replacement = path.join(directory, intent.replacement), target = path.join(directory, 'control.sqlite');
  const pending = await digest(replacement), installed = await digest(target);
  if (pending !== intent.hash && !(pending === null && installed === intent.hash)) throw fail('Control replacement checksum mismatch.');
  for (const row of intent.originals) {
    const original = path.join(directory, row.name), saved = path.join(quarantine, row.name);
    const originalHash = await digest(original), savedHash = await digest(saved);
    if (savedHash === row.hash && (originalHash === null || row.name === 'control.sqlite' && originalHash === intent.hash)) continue;
    if (savedHash !== null || originalHash !== row.hash) throw fail('Control quarantine differs from its recovery intent.');
    await fs.rename(original, saved);
    await syncParentDirectory(saved);
    await syncParentDirectory(original);
  }
  if (pending !== null) { await fs.rename(replacement, target); await syncParentDirectory(target); }
  const bytes = (await fs.stat(intentPath)).size;
  await fs.unlink(intentPath);
  await syncParentDirectory(intentPath);
  diskAccount.release(bytes);
  return true;
};

/** The short gate coordinates opens/repair; markers permit concurrent healthy
 * clients. Corruption is the only automatic replacement trigger. Scope, schema,
 * busy and capacity failures always propagate without renaming anything.
 */
export const openSemanticControlStore = async ({ Database, filename, diskAccount, reconstruct, maxAttempts = 3, signal = null }) => {
  if (typeof Database !== 'function') return { available: false, reason: 'sqlite_control_store_unavailable' };
  const directory = path.dirname(filename);
  if (path.basename(filename) !== 'control.sqlite') throw fail('Unexpected semantic control filename.');
  await fs.mkdir(directory, { recursive: true });
  if ((await fs.lstat(directory)).isSymbolicLink()) throw fail('Control directory cannot be a link.');
  // Bounded gate metadata is included while the gate exists.
  diskAccount.reserve(4096);
  let gate, control;
  try {
    gate = await acquireFileLock({ lockPath: path.join(directory, '.control-open.lock'), waitMs: 5000,
      timeoutBehavior: 'throw', metadata: { purpose: 'semantic-control-open' }, signal });
    const intentPath = path.join(directory, '.control-repair.json');
    await finishRepair({ directory, intentPath, diskAccount });
    for (const suffix of ['', '-journal', '-wal', '-shm']) {
      try {
        const stat = await fs.lstat(filename + suffix);
        if (!stat.isFile() || stat.isSymbolicLink()) throw fail('Control storage cannot contain links.');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try {
      await checkHeader(filename);
      control = openSemanticFrontier({ Database, filename, diskAccount, maxAttempts });
    }
    catch (error) {
      if (!['SQLITE_CORRUPT', 'SQLITE_NOTADB'].includes(error.code) || typeof reconstruct !== 'function') throw error;
      await assertNoClients(directory);
      const id = randomUUID(), replacement = '.repair-' + id + '.sqlite';
      const replacementPath = path.join(directory, replacement);
      const rebuilt = openSemanticFrontier({ Database, filename: replacementPath, diskAccount, maxAttempts });
      try { await reconstruct(rebuilt); } finally { rebuilt.close(); }
      const handle = await fs.open(replacementPath, 'r+');
      try { await handle.sync(); } finally { await handle.close(); }
      await syncParentDirectory(replacementPath);
      const originals = [];
      for (const name of ['control.sqlite', 'control.sqlite-journal', 'control.sqlite-wal', 'control.sqlite-shm']) {
        const hash = await digest(path.join(directory, name));
        if (hash) originals.push({ name, hash });
      }
      await writeSemanticJson({ filename: intentPath, value: { version: 1, replacement,
        quarantine: '.corrupt-' + id, hash: await digest(replacementPath), originals }, diskAccount, signal });
      await finishRepair({ directory, intentPath, diskAccount });
      control = openSemanticFrontier({ Database, filename, diskAccount, maxAttempts });
    }
    const marker = path.join(directory, '.client-' + randomUUID() + '.json');
    const owner = { pid: process.pid, hostname: os.hostname() };
    const bytes = Buffer.from(JSON.stringify(owner) + '\n');
    await writeSemanticJson({ filename: marker, value: owner, diskAccount, signal });
    const close = control.close;
    let closed = false;
    control.close = () => {
      if (closed) return;
      close(); closed = true;
      fsSync.unlinkSync(marker);
      diskAccount.release(bytes.length);
    };
    return control;
  } catch (error) { control?.close(); throw error; }
  finally {
    if (gate) { await gate.release(); diskAccount.release(4096); }
    else diskAccount.release(4096);
  }
};
