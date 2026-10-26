import { extractComments } from '../../../comments.js';
import { COMMENT_CLASSIFICATION_VERSION, commentPolicyReceipt } from '../../../comments-policy.js';
import { sha1 } from '../../../../shared/hash.js';
import { stableStringifyForSignature } from '../../../../shared/stable-json.js';

const ownedEntries = new WeakSet();
export const buildExtractedProseExtrasCacheKey = ({ fileHash, fileHashAlgo, ext, languageId, normalizedCommentsConfig } = {}) => {
  if (typeof fileHash !== 'string' || !fileHash.trim()) return null;
  const algo = typeof fileHashAlgo === 'string' && fileHashAlgo.trim() ? fileHashAlgo.trim().toLowerCase() : 'unknown';
  const suffix = typeof ext === 'string' ? ext.trim().toLowerCase() : '';
  const language = typeof languageId === 'string' ? languageId.trim().toLowerCase() : '';
  const policy = sha1(stableStringifyForSignature(commentPolicyReceipt(normalizedCommentsConfig)));
  return `comments:${COMMENT_CLASSIFICATION_VERSION}|hash:${algo}:${fileHash.trim()}|ext:${suffix}|lang:${language}|policy:${policy}`;
};
const freezeData = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeData(nested);
  return Object.freeze(value);
};

/** Cache raw extraction only. Tokenization/admission always uses the consuming
 * pass's dictionary and config. Stored payload remains visible to byte accounting;
 * private branding prevents author-injected/stale entries from becoming proof.
 */
export const resolveExtractedProseCommentData = ({ cache, key, text, ext, languageId, lineIndex, normalizedCommentsConfig }) => {
  const enabled = key && typeof cache?.get === 'function' && typeof cache?.set === 'function';
  const cached = enabled ? cache.get(key) : null;
  if (cached && ownedEntries.has(cached) && cached.key === key) return structuredClone(cached.data);
  const data = extractComments({ text, ext, languageId, lineIndex, config: normalizedCommentsConfig });
  if (enabled) {
    const stored = Object.freeze({ key, data: freezeData(structuredClone(data)) });
    ownedEntries.add(stored); cache.set(key, stored);
  }
  return data;
};
