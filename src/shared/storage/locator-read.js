import path from 'node:path';
import { readVerifiedContainedFileSync } from '../contained-file.js';
import { STORAGE_CATEGORIES } from './layout.js';

export const STORAGE_LOCATOR_NAME = 'storage-locations.json';

export const readStorageLocator = home => {
  const target = path.join(path.resolve(home), 'config', STORAGE_LOCATOR_NAME);
  let locatorRead = false;
  try {
    const { buffer, hash } = readVerifiedContainedFileSync(path.parse(target).root, target, { maxBytes: 1024 * 1024 });
    locatorRead = true;
    const value = JSON.parse(buffer.toString('utf8'));
    if (value?.schemaVersion !== 1 || !value.categories || typeof value.categories !== 'object' || Array.isArray(value.categories)) {
      throw new Error('Storage locator is incompatible.');
    }
    for (const [key, entry] of Object.entries(value.categories)) {
      if (!Object.hasOwn(STORAGE_CATEGORIES, key) || !entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)
        || typeof entry.migrationId !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.migrationId)) throw new Error('Storage locator contains an invalid category entry.');
      if (entry.selectionKind === 'configuration') {
        const receiptPath = path.join(path.resolve(home), 'config', 'storage-selections', `${entry.migrationId}.json`);
        const receipt = readVerifiedContainedFileSync(path.parse(receiptPath).root, receiptPath, { maxBytes: 1024 * 1024 });
        const selection = JSON.parse(receipt.buffer.toString('utf8'));
        if (receipt.hash !== entry.receiptHash || selection.schemaVersion !== 1
          || selection.kind !== 'pairofcleats-storage-configuration-selection' || selection.selectionId !== entry.migrationId
          || selection.home !== path.resolve(home) || selection.category !== key || selection.path !== entry.path
          || selection.deletionAuthority !== false) throw new Error('Storage configuration selection receipt is missing, changed or belongs to another category.');
      } else if (entry.selectionKind !== undefined && entry.selectionKind !== 'migration') {
        throw new Error('Storage locator contains an unknown selection owner.');
      }
    }
    return { status: 'present', target, value, sha256: hash };
  } catch (error) {
    if (!locatorRead && error.code === 'ENOENT') return { status: 'missing', target, value: { schemaVersion: 1, categories: {} }, sha256: null };
    return { status: 'invalid', target, value: null, sha256: null, error: { code: error.code || 'ERR_STORAGE_LOCATOR', message: error.message } };
  }
};
