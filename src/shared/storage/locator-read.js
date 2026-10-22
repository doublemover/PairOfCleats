import path from 'node:path';
import { readVerifiedContainedFileSync } from '../contained-file.js';
import { assertStorageLocatorShape, assertStorageSelectionShape } from './locator-contract.js';

export const STORAGE_LOCATOR_NAME = 'storage-locations.json';

export const readStorageLocator = home => {
  const target = path.join(path.resolve(home), 'config', STORAGE_LOCATOR_NAME);
  let locatorRead = false;
  try {
    const { buffer, hash } = readVerifiedContainedFileSync(path.parse(target).root, target, { maxBytes: 1024 * 1024 });
    locatorRead = true;
    const value = JSON.parse(buffer.toString('utf8'));
    assertStorageLocatorShape(value);
    for (const [key, entry] of Object.entries(value.categories)) {
      if (entry.selectionKind === 'configuration') {
        const receiptPath = path.join(path.resolve(home), 'config', 'storage-selections', `${entry.migrationId}.json`);
        const receipt = readVerifiedContainedFileSync(path.parse(receiptPath).root, receiptPath, { maxBytes: 1024 * 1024 });
        const selection = JSON.parse(receipt.buffer.toString('utf8'));
        if (!selection || Object.keys(selection).sort().join(',') !== 'category,deletionAuthority,home,kind,path,priorSelection,schemaVersion,selectionId,sourcePreserved'
          || receipt.hash !== entry.receiptHash || selection.schemaVersion !== 1
          || selection.kind !== 'pairofcleats-storage-configuration-selection' || selection.selectionId !== entry.migrationId
          || selection.home !== path.resolve(home) || selection.category !== key || selection.path !== entry.path
          || selection.sourcePreserved !== true || selection.deletionAuthority !== false) throw new Error('Storage configuration selection receipt is missing, changed or belongs to another category.');
        if (selection.priorSelection !== null) assertStorageSelectionShape(selection.priorSelection);
      }
    }
    return { status: 'present', target, value, sha256: hash };
  } catch (error) {
    if (!locatorRead && error.code === 'ENOENT') return { status: 'missing', target, value: { schemaVersion: 1, categories: {} }, sha256: null };
    return { status: 'invalid', target, value: null, sha256: null, error: { code: error.code || 'ERR_STORAGE_LOCATOR', message: error.message } };
  }
};
