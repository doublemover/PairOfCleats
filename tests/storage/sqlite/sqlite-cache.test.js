#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSqliteDbCache } from '../../../src/retrieval/sqlite-cache.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-sqlite-cache-'));
const dbPath = path.join(tempRoot, 'index.db');
await fs.writeFile(dbPath, 'initial');

const cache = createSqliteDbCache();
let closed = false;
const db = { close: () => { closed = true; } };
cache.set(dbPath, db);

const first = cache.get(dbPath);
assert.equal(first, db, 'should return cached db');

await fs.writeFile(dbPath, 'changed');
const second = cache.get(dbPath);
assert.equal(second, null, 'should invalidate on signature change');
assert.equal(closed, true, 'should close invalidated db');

console.log('sqlite cache tests passed');
