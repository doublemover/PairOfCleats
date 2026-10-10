#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import Database from 'better-sqlite3';
import { openSemanticControlStore } from '../../../src/index/semantic/control-store.js';
import { createSemanticTaskId } from '../../../src/index/semantic/identity.js';
import { reopenSemanticDiskAccount } from '../../../src/index/build/incremental/working-set.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-control-repair-'));
const inputHashes = ['a'.repeat(64)], policyHash = 'b'.repeat(64), targetSetHash = 'c'.repeat(64);
const task = { schemaVersion: 1, taskId: createSemanticTaskId({ kind: 'bind', inputHashes, policyHash, targetSetHash }),
  kind: 'bind', baseBuildId: 'base', sourceUnits: ['su1:' + 'd'.repeat(64)], inputHashes, policyHash,
  targetSetHash, targetsRef: 'immutable:targets', dependencies: [], priority: 1, reason: 'deferred', coverageToProduce: ['bindings'] };
const reconstruct = async control => control.enqueue({ task, durableInputHashes: new Set(inputHashes) });
const open = async (directory, extra = {}) => {
  const { account } = await reopenSemanticDiskAccount({ roots: [directory], limit: 32 * 1024 * 1024 });
  return openSemanticControlStore({ Database, filename: path.join(directory, 'control.sqlite'), diskAccount: account, reconstruct, ...extra });
};
const stopChild = async (directory, action) => {
  const child = fork(new URL('../../helpers/semantic-control-interruption.js', import.meta.url), [directory, action],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const exited = once(child, 'exit');
  let timeout;
  try {
    await Promise.race([
      once(child, 'message').then(([message]) => assert.equal(message.ready, true)),
      exited.then(() => { throw new Error('Child exited before cut: ' + stderr); }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Child interruption boundary timed out.')), 8000); })
    ]);
    child.kill('SIGKILL'); await exited;
  } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; } }
};
try {
  for (const cut of ['none', 'quarantine', 'install', 'hot-journal']) {
    const directory = path.join(root, cut); await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'task.json'), JSON.stringify(task));
    const original = Buffer.from('damaged SQLite bytes: ' + cut);
    if (cut !== 'hot-journal') {
      await fs.writeFile(path.join(directory, 'control.sqlite'), original);
      await fs.writeFile(path.join(directory, 'control.sqlite-journal'), 'damaged journal');
    }
    if (cut !== 'none') await stopChild(directory, cut);
    const store = await open(directory);
    assert.equal(store.getTask(task.taskId).state, 'pending');
    assert.equal(store.getTask(task.taskId).lastError, null, 'uncommitted writes roll back');
    store.close();
    if (cut !== 'hot-journal') {
      const saved = (await fs.readdir(directory)).find(name => name.startsWith('.corrupt-'));
      assert.deepEqual(await fs.readFile(path.join(directory, saved, 'control.sqlite')), original);
      assert.equal(await fs.readFile(path.join(directory, saved, 'control.sqlite-journal'), 'utf8'), 'damaged journal');
    }
    await assert.rejects(fs.access(path.join(directory, '.control-repair.json')), { code: 'ENOENT' });
    const again = await open(directory); assert.deepEqual(again.getDescriptor(task.taskId), task); again.close();
  }
  const blocked = path.join(root, 'blocked'); await fs.mkdir(blocked);
  const filename = path.join(blocked, 'control.sqlite');
  await fs.writeFile(filename, 'corrupt');
  const marker = path.join(blocked, '.client-abcdef.json');
  await fs.writeFile(marker, JSON.stringify({ pid: process.pid, hostname: os.hostname() }));
  await assert.rejects(open(blocked), /client may be active/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'corrupt');
  await fs.unlink(marker);
  await assert.rejects(open(blocked, { reconstruct: async () => { throw new Error('publication is unverified'); } }), /unverified/);
  assert.equal(await fs.readFile(filename, 'utf8'), 'corrupt', 'failed verification preserves original control');
  const scope = path.join(root, 'scope'); await fs.mkdir(scope);
  const unrelated = new Database(path.join(scope, 'control.sqlite')); unrelated.exec('CREATE TABLE retrieval(id)'); unrelated.close();
  await assert.rejects(open(scope), { code: 'ERR_SEMANTIC_CONTROL_STORE_SCOPE' });
  assert.equal((await fs.readdir(scope)).some(name => name.startsWith('.corrupt-')), false);
  console.log('control store repair and controlled process interruption passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
