import { isDocsPath, isFixturePath, shouldPreferInfraProse } from '../mode-routing.js';

const getLowerBasename = (fileLower) => {
  if (!fileLower || typeof fileLower !== 'string') return null;
  const slashIndex = Math.max(fileLower.lastIndexOf('/'), fileLower.lastIndexOf('\\'));
  return slashIndex >= 0 ? fileLower.slice(slashIndex + 1) : fileLower;
};

const getLowerExtension = (baseNameLower) => {
  if (!baseNameLower || typeof baseNameLower !== 'string') return '';
  const dotIndex = baseNameLower.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === (baseNameLower.length - 1)) return '';
  return baseNameLower.slice(dotIndex);
};

const GENERATED_DOC_BASENAME_SET = new Set([
  'mkdocs.yml',
  'antora.yml',
  'manual.txt',
  'docbook-entities.txt',
  'idnamappingtable.txt'
]);
const GENERATED_DOC_EXT_SET = new Set(['.html', '.htm']);
const LICENSE_LIKE_RE = /(^|[-_.])(license|licence|copying|copyright|notice)([-_.]|$)/i;
const RFC_TXT_RE = /^rfc\d+\.txt$/i;

const hasLicenseBoilerplateTags = (tags) => {
  if (!Array.isArray(tags) || !tags.length) return false;
  for (const tag of tags) {
    if (typeof tag !== 'string') continue;
    const normalized = tag.trim().toLowerCase();
    if (!normalized) continue;
    if (normalized === 'boilerplate:license') return true;
    if (normalized.startsWith('license:')) return true;
  }
  return false;
};

const hasLicenseLikePath = (fileLower, baseNameLower) => {
  if (!fileLower || !baseNameLower) return false;
  if (LICENSE_LIKE_RE.test(baseNameLower)) return true;
  if (fileLower.startsWith('licenses/') || fileLower.startsWith('licenses\\')) return true;
  if (fileLower.includes('/licenses/') || fileLower.includes('\\licenses\\')) return true;
  return false;
};

const hasGeneratedDocPath = (fileLower, baseNameLower) => {
  if (!fileLower || !baseNameLower) return false;
  const ext = getLowerExtension(baseNameLower);
  if (isDocsPath(fileLower) && GENERATED_DOC_EXT_SET.has(ext)) return true;
  if (GENERATED_DOC_BASENAME_SET.has(baseNameLower)) return true;
  if (isDocsPath(fileLower) && RFC_TXT_RE.test(baseNameLower)) return true;
  return false;
};

/**
 * Decide whether phrase postings should be suppressed for a chunk/file pair.
 *
 * This applies deterministic heuristics for fixtures, infra/prose docs, license
 * material, and generated documentation to reduce noisy high-frequency terms.
 *
 * @param {object} chunk
 * @param {string} fileLower
 * @returns {boolean}
 */
export const shouldSkipPhrasePostingsForChunk = (chunk, fileLower) => {
  const baseNameLower = getLowerBasename(fileLower);
  if (baseNameLower === 'cmakelists.txt') return true;
  if (isFixturePath(fileLower)) return true;
  if (shouldPreferInfraProse({ relPath: fileLower })) return true;
  if (hasLicenseLikePath(fileLower, baseNameLower)) return true;
  if (hasGeneratedDocPath(fileLower, baseNameLower)) return true;
  const chunkTags = Array.isArray(chunk?.docmeta?.boilerplateTags) ? chunk.docmeta.boilerplateTags : null;
  if (hasLicenseBoilerplateTags(chunkTags)) return true;
  const metaTags = Array.isArray(chunk?.metaV2?.docmeta?.boilerplateTags)
    ? chunk.metaV2.docmeta.boilerplateTags
    : null;
  return hasLicenseBoilerplateTags(metaTags);
};
