import path from 'node:path';
import { resolveChunkDocmeta } from './output/filters/meta.js';

export const FILTER_FACTS_VERSION = 2;
export const resolveFilterExtension = chunk => chunk?.ext || path.extname(chunk?.file || '');
export const resolveFilterLanguage = chunk => {
  for (const value of [chunk?.metaV2?.lang, chunk?.metaV2?.effective?.languageId, chunk?.lang]) {
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }
  return 'unknown';
};

/** Non-null docmeta fields override metaV2; explicit merged visibility wins
 * over merged modifiers, matching the metadata fallback contract. */
export const resolveFilterVisibility = chunk => {
  const facts = resolveChunkDocmeta(chunk);
  if (facts?.visibility) return facts.visibility;
  const modifiers = facts?.modifiers;
  if (!modifiers) return null;
  if (!Array.isArray(modifiers)) return typeof modifiers.visibility === 'string' ? modifiers.visibility : null;
  for (const entry of modifiers) {
    const token = String(entry || '').trim().toLowerCase();
    if (token.startsWith('visibility:')) {
      const value = token.slice('visibility:'.length).trim();
      if (value) return value;
    }
    if (['public', 'private', 'protected', 'internal'].includes(token)) return token;
  }
  return null;
};
