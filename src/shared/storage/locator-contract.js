import path from 'node:path';
import { STORAGE_CATEGORIES } from './layout.js';

export const STORAGE_LOCATOR_VERSION = 1;
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

/** Unknown fields can encode retention/ownership semantics. Cutover must not
 * silently discard them while rebuilding a locator or restoring a selection.
 */
export const assertStorageSelectionShape = (entry, { pathApi = path } = {}) => {
  if (!onlyKeys(entry, ['path', 'migrationId', 'owner', 'selectionKind', 'receiptHash'])
    || typeof entry.path !== 'string' || !pathApi.isAbsolute(entry.path) || /[\x00-\x1f]/u.test(entry.path)
    || !hash(entry.migrationId) || (entry.owner !== undefined && (typeof entry.owner !== 'string' || !entry.owner || entry.owner.length > 256))) {
    throw new Error('Storage locator contains an invalid category entry or unknown retained metadata.');
  }
  if (entry.selectionKind === 'configuration') {
    if (!hash(entry.receiptHash) || entry.owner !== undefined) throw new Error('Storage configuration selection identity is incompatible.');
  } else if ((entry.selectionKind !== undefined && entry.selectionKind !== 'migration') || entry.receiptHash !== undefined) {
    throw new Error('Storage locator contains an unknown selection owner.');
  }
};

export const assertStorageLocatorShape = (value, options = {}) => {
  if (!onlyKeys(value, ['schemaVersion', 'categories']) || value.schemaVersion !== STORAGE_LOCATOR_VERSION || !record(value.categories)) {
    throw new Error('Storage locator is incompatible or carries unknown retained metadata.');
  }
  for (const [category, entry] of Object.entries(value.categories)) {
    if (!Object.hasOwn(STORAGE_CATEGORIES, category)) throw new Error('Storage locator contains an unknown category.');
    assertStorageSelectionShape(entry, options);
  }
};
