#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { writeSemanticJson, retainSemanticBytes } from '../../../src/index/semantic/disk-writes.js';
import { persistSemanticEvidence } from '../../../src/index/semantic/lsp-evidence.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
import { openSemanticFrontier } from '../../../src/index/semantic/frontier.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-metadata-account-'));
try {
  const filename = path.join(root, 'metadata.json'), account = createSemanticDiskAccount(32);
  await writeSemanticJson({ filename, value: { a: 1 }, diskAccount: account });
  const original = await fs.readFile(filename);
  assert.equal(account.used, original.length);
  await assert.rejects(writeSemanticJson({ filename, value: { a: 'x'.repeat(20) }, diskAccount: account }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.deepEqual(await fs.readFile(filename), original);
  await writeSemanticJson({ filename, value: { b: 2 }, diskAccount: account });
  assert.equal(account.used, original.length);
  const immutable = path.join(root, 'immutable'), bytes = Buffer.from('complete immutable bytes');
  const retained = createSemanticDiskAccount(100);
  await Promise.all(Array.from({ length: 3 }, () => retainSemanticBytes({ filename: immutable, bytes, diskAccount: retained })));
  assert.equal(retained.used, bytes.length, 'losing equivalent writes return transient credits');
  await assert.rejects(retainSemanticBytes({ filename: immutable, bytes: Buffer.from('different'), diskAccount: retained }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  const inventory = [], evidence = createSemanticDiskAccount(1024);
  await persistSemanticEvidence({ value: { evidence: true }, stagingRoot: root, diskAccount: evidence, inventory });
  const used = evidence.used;
  await persistSemanticEvidence({ value: { evidence: true }, stagingRoot: root, diskAccount: evidence, inventory: [] });
  assert.equal(evidence.used, used, 'reused evidence is not charged twice');
  const control = path.join(root, 'control.sqlite');
  assert.throws(() => openSemanticFrontier({ Database, filename: control, diskAccount: createSemanticDiskAccount(65536) }), { code: 'ERR_SEMANTIC_DISK_LIMIT' });
  assert.equal((await fs.stat(control)).size, 0, 'journal admission precedes schema writes');
  const budget = createSemanticDiskAccount(1024 * 1024);
  const store = openSemanticFrontier({ Database, filename: control, diskAccount: budget }); store.close();
  assert.equal(budget.used, (await fs.stat(control)).size, 'unused journal and growth credits return after commit');
  await assert.rejects(fs.access(control + '-journal'), { code: 'ENOENT' });
  const mainBytes = (await fs.stat(control)).size;
  const tight = createSemanticDiskAccount(mainBytes * 2 + Math.ceil(mainBytes / 4096) * 8 + 131072 + 8192);
  tight.reserve(mainBytes);
  const constrained = openSemanticFrontier({ Database, filename: control, diskAccount: tight });
  assert.throws(() => constrained.leaseReady({ baseBuildId: 'base', owner: 'writer',
    dependencyHashes: new Map(Array.from({ length: 1000 }, (_, i) => ['dependency-' + i + 'x'.repeat(200), 'a'.repeat(64)])) }),
  { code: 'ERR_SEMANTIC_DISK_LIMIT' }, 'SQLite page ceiling enforces admission inside a growing transaction');
  constrained.close();
  assert.equal((await fs.stat(control)).size, mainBytes, 'capacity failure rolls the transaction back');
  assert.equal(tight.used, mainBytes, 'rolled-back journal bytes return only after deletion');
  const roomy = createSemanticDiskAccount(32 * 1024 * 1024); roomy.reserve(mainBytes);
  const growing = openSemanticFrontier({ Database, filename: control, diskAccount: roomy });
  assert.deepEqual(growing.leaseReady({ baseBuildId: 'base', owner: 'writer',
    dependencyHashes: new Map(Array.from({ length: 5000 }, (_, i) => ['dependency-' + i + 'x'.repeat(1024), 'a'.repeat(64)])) }), []);
  growing.close();
  assert.ok((await fs.stat(control)).size > 4 * 1024 * 1024, 'valid transactions can use the configured remaining budget');
  assert.equal(roomy.used, (await fs.stat(control)).size);
  console.log('metadata, immutable evidence and SQLite transient admission passed');
} finally { await fs.rm(root, { recursive: true, force: true }); }
