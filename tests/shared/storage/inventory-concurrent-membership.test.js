import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { inspectStorageInventory } from '../../../src/shared/storage/inventory.js';

const temporary = await makeTempDir('poc-storage-inventory-membership-');
const original = fs.opendir;
try {
  const root = path.join(temporary, 'owned');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'existing.txt'), 'retained');
  let injected = false;
  fs.opendir = async (...args) => {
    const directory = await original(...args);
    if (path.resolve(args[0]) === root) {
      const read = directory.read.bind(directory);
      directory.read = async (...parameters) => {
        const entry = await read(...parameters);
        if (!entry && !injected) {
          injected = true;
          await fs.writeFile(path.join(root, 'late-member.txt'), 'new-user-data');
        }
        return entry;
      };
    }
    return directory;
  };
  const inventory = await inspectStorageInventory({ roots: [{ id: 'fixture-root', path: root }], includeFiles: true });
  assert.equal(injected, true);
  assert.equal(inventory.complete, false, 'observed enumeration cannot claim a complete stable directory after concurrent creation');
  assert.equal(inventory.errors.some(error => error.code === 'ERR_STORAGE_SCAN_CHANGED'), true);
  assert.equal(await fs.readFile(path.join(root, 'late-member.txt'), 'utf8'), 'new-user-data');
} finally { fs.opendir = original; await rmDirRecursive(temporary); }
console.log('storage concurrent membership stays incomplete passed');
