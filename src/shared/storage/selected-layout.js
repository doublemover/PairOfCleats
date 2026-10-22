import { STORAGE_CATEGORIES, storagePathApi } from './layout.js';
import { isPathWithinRoot } from '../file-paths.js';

const inputOf = descriptor => ({ path: descriptor.path, lexicalPath: descriptor.lexicalPath,
  source: descriptor.source, relativeBase: descriptor.relativeBase });

/** Pure overlay of the locator reader's verified receipt. Explicit existing
 * launch/env/machine inputs retain precedence. Selection is never ownership or
 * deletion authority, and this function never reads or writes the filesystem.
 */
export const applyStorageLocatorSelections = (layout, locator) => {
  const api = storagePathApi(layout.platform);
  const expected = api.join(layout.home.path, 'config', 'storage-locations.json');
  const normalize = value => layout.platform === 'win32' ? api.resolve(value).toLowerCase() : api.resolve(value);
  if (!locator || !['missing', 'present'].includes(locator.status) || normalize(locator.target) !== normalize(expected)
    || locator.value?.schemaVersion !== 1 || !locator.value.categories || typeof locator.value.categories !== 'object'
    || Array.isArray(locator.value.categories) || (locator.status === 'present' && !/^[a-f0-9]{64}$/u.test(locator.sha256 || ''))
    || (locator.status === 'missing' && (locator.sha256 !== null || Object.keys(locator.value.categories).length))) {
    throw Object.assign(new Error('Active storage locator is unreadable, incompatible or belongs to another home.'), { code: 'ERR_STORAGE_LOCATOR' });
  }
  const descriptors = { ...layout.descriptors };
  const diagnostics = [...layout.diagnostics];
  for (const [category, selection] of Object.entries(locator.value.categories)) {
    if (!Object.hasOwn(STORAGE_CATEGORIES, category) || !selection || typeof selection.path !== 'string'
      || !api.isAbsolute(selection.path) || !/^[a-f0-9]{64}$/u.test(selection.migrationId || '')) throw new Error('Verified storage locator has an invalid category selection.');
    const current = descriptors[category];
    const selected = { path: api.resolve(selection.path), lexicalPath: selection.path, relativeBase: layout.home.path,
      source: `locator.categories.${category}`, migrationId: selection.migrationId, selectionKind: selection.selectionKind || 'migration' };
    if (current.source === selected.source && current.migrationId === selected.migrationId && normalize(current.path) === normalize(selected.path)) continue;
    if (current.source !== 'layout-default') {
      if (current.shadowed.some(input => input.source === selected.source && input.migrationId === selected.migrationId
        && normalize(input.path) === normalize(selected.path))) continue;
      descriptors[category] = { ...current, shadowed: [selected, ...current.shadowed] };
      diagnostics.push({ category, code: 'shadowed-storage-selection', selectedSource: current.source, locatorSource: selected.source });
      continue;
    }
    descriptors[category] = { ...current, ...selected, resolvedPath: selected.path,
      external: !isPathWithinRoot(selected.path, layout.home.path, { platform: layout.platform }),
      shadowed: [inputOf(current), ...current.shadowed], deletionAuthority: false };
    diagnostics.push({ category, code: 'verified-category-selection', source: selected.source });
  }
  for (const category of ['repos', 'shared', 'cas']) {
    if (descriptors[category].source !== 'layout-default') continue;
    const selected = api.join(descriptors.cache.path, category);
    descriptors[category] = { ...descriptors[category], path: selected, resolvedPath: selected, lexicalPath: selected,
      external: !isPathWithinRoot(selected, layout.home.path, { platform: layout.platform }), derivedFrom: 'cache' };
  }
  return { ...layout, descriptors, diagnostics, locator: { path: locator.target, sha256: locator.sha256,
    status: locator.status, mutationPerformed: false, deletionAuthority: false } };
};
