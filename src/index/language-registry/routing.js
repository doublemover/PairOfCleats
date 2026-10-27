import path from 'node:path';
import { toArray } from '../../shared/iterables.js';
import { LANGUAGE_ROUTE_DESCRIPTORS } from './descriptors.js';
import { LINGUIST_LANGUAGES } from './linguist-data.js';
import { buildLinguistRoutingMaps, normalizeLinguistName } from './linguist-routing.js';

const descriptors = new Map(LANGUAGE_ROUTE_DESCRIPTORS.map(descriptor => [descriptor.id, descriptor]));

/** One chooser for immutable metadata and actual adapter lookup. Construction
 * captures supported IDs; no parser, adapter, source or readiness is initialized.
 */
export const createLanguageRouteResolver = (availableIds = descriptors) => {
  const extensions = new Map(), filenames = new Map(), prefixes = [];
  for (const descriptor of LANGUAGE_ROUTE_DESCRIPTORS) {
    const languageId = descriptor?.id;
    if (!languageId || !availableIds.has(languageId)) continue;
    for (const ext of toArray(descriptor.extensions)) {
      const key = String(ext || '').toLowerCase();
      if (key && !extensions.has(key)) extensions.set(key, languageId);
    }
    for (const filename of toArray(descriptor.specialFilenames)) {
      const key = String(filename || '').toLowerCase();
      if (key && !filenames.has(key)) filenames.set(key, languageId);
    }
    for (const prefix of toArray(descriptor.specialPrefixes)) {
      const key = String(prefix || '').toLowerCase();
      if (key) prefixes.push({ prefix: key, languageId });
    }
  }
  const linguist = buildLinguistRoutingMaps(LINGUIST_LANGUAGES, availableIds);
  return (ext, relPath) => {
    const baseName = normalizeLinguistName(path.basename(relPath || ''));
    const extKey = normalizeLinguistName(ext);
    if (baseName && filenames.has(baseName)) return filenames.get(baseName);
    if (extKey && extensions.has(extKey)) return extensions.get(extKey);
    if (baseName) for (const entry of prefixes) {
      if (baseName === entry.prefix || baseName.startsWith(`${entry.prefix}.`)) return entry.languageId;
    }
    if (baseName && linguist.filenames.has(baseName)) return linguist.filenames.get(baseName);
    return extKey ? linguist.extensions.get(extKey) || null : null;
  };
};

const resolveRouteId = createLanguageRouteResolver();
/** Metadata only. Adapter operations remain on the existing registry boundary. */
export const getLanguageRouteForFile = (ext, relPath) => descriptors.get(resolveRouteId(ext, relPath)) || null;
