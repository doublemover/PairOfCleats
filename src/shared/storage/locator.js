import fs from 'node:fs';
import path from 'node:path';
import { assertNoSymlinkPath } from '../contained-file.js';
import { atomicWriteJson } from '../io/atomic-write.js';
import { readStorageLocator } from './locator-read.js';
import { assertStorageLocatorShape } from './locator-contract.js';
export { STORAGE_LOCATOR_NAME, readStorageLocator } from './locator-read.js';

/** Configuration updates use an exact prior locator under its owner's lock. */
export const writeStorageLocator = async (home, value, { expectedHash = null } = {}) => {
  assertStorageLocatorShape(value);
  const before = readStorageLocator(home);
  if (before.status === 'invalid' || before.sha256 !== expectedHash) throw new Error('Storage locator changed before cutover.');
  assertNoSymlinkPath(path.parse(before.target).root, before.target, { allowMissing: true });
  await fs.promises.mkdir(path.dirname(before.target), { recursive: true });
  assertNoSymlinkPath(path.parse(before.target).root, before.target, { allowMissing: true });
  await atomicWriteJson(before.target, value, { mkdir: false, beforeCommit: () => {
    const current = readStorageLocator(home);
    if (current.status === 'invalid' || current.sha256 !== expectedHash) throw new Error('Storage locator changed during cutover.');
    assertNoSymlinkPath(path.parse(before.target).root, before.target, { allowMissing: true });
  } });
  return readStorageLocator(home);
};
