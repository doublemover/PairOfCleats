import fs from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openSemanticControlStore } from '../../src/index/semantic/control-store.js';
import { reopenSemanticDiskAccount } from '../../src/index/build/incremental/working-set.js';

const [directory, action] = process.argv.slice(2);
const filename = path.join(directory, 'control.sqlite');
const task = JSON.parse(await fs.readFile(path.join(directory, 'task.json'), 'utf8'));
const { account } = await reopenSemanticDiskAccount({ roots: [directory], limit: 32 * 1024 * 1024 });
const reconstruct = async control => control.enqueue({ task, durableInputHashes: new Set(task.inputHashes) });
if (action === 'hot-journal') {
  const control = await openSemanticControlStore({ Database, filename, diskAccount: account });
  await reconstruct(control); control.close();
  const db = new Database(filename);
  db.pragma('synchronous = FULL'); db.pragma('cache_size = 1'); db.pragma('cache_spill = ON');
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE tasks SET lastError=? WHERE taskId=?').run('x'.repeat(200000), task.taskId);
  process.send({ ready: true });
  setInterval(() => {}, 1000);
} else {
  const rename = fs.rename;
  fs.rename = async (source, target) => {
    await rename(source, target);
    const stop = action === 'quarantine' ? path.basename(path.dirname(target)).startsWith('.corrupt-')
      : action === 'install' && path.basename(target) === 'control.sqlite';
    if (stop) { process.send({ ready: true }); await new Promise(() => {}); }
  };
  await openSemanticControlStore({ Database, filename, diskAccount: account, reconstruct });
  throw new Error('Expected interruption boundary was not reached.');
}
