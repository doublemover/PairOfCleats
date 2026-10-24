#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createScopedFileInventory } from '../../../tools/shared/file-inventory.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('scoped-file-inventory');
await fs.mkdir(path.join(root, 'src', 'a'), { recursive: true }); await fs.mkdir(path.join(root, 'src', 'ab'), { recursive: true });
await fs.writeFile(path.join(root, 'src/a/one.js'), 'one'); await fs.writeFile(path.join(root, 'src/ab/two.js'), 'two'); await fs.writeFile(path.join(root, 'root.json'), '{}');
const readdir = fs.readdir, visits = new Map(); let inventory;
try {
  fs.readdir = async (target, ...args) => { const key = path.resolve(String(target)); visits.set(key, (visits.get(key) || 0) + 1); return readdir(target, ...args); };
  inventory = await createScopedFileInventory(root, ['src', 'src/a', 'src/ab', 'missing'], { files: ['root.json'] });
} finally { fs.readdir = readdir; }
assert.ok([...visits.values()].every(count => count === 1));
assert.deepEqual(inventory.under('src/a'), ['src/a/one.js']); assert.deepEqual(inventory.under('src/ab'), ['src/ab/two.js']);
assert.equal(inventory.has('root.json'), true); assert.equal(visits.has(root), false, 'an explicit root file does not authorize walking its parent');
await fs.writeFile(path.join(root, 'src/a/new.js'), 'new');
assert.equal(inventory.has('src/a/new.js'), false);
const refreshed = await createScopedFileInventory(root, ['src']); assert.equal(refreshed.has('src/a/new.js'), true);
