import { checksumString } from '../../shared/hash.js';

/** Schema version for VFS hash routing. */
export const VFS_HASH_ROUTING_SCHEMA_VERSION = '1.0.0';

const normalizeMode = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'docHash+virtualPath';
  return raw;
};

/**
 * Build a deterministic routing token for VFS hash paths.
 * @param {{ virtualPath: string, docHash: string, mode?: string }} input
 * @returns {Promise<string|null>}
 */
export const buildVfsRoutingToken = async ({
  virtualPath,
  docHash,
  mode = 'docHash+virtualPath'
} = {}) => {
  if (!virtualPath || !docHash) return null;
  const resolvedMode = normalizeMode(mode);
  const routingKey = resolvedMode === 'docHash'
    ? String(docHash)
    : `${docHash}|${virtualPath}`;
  const result = await checksumString(routingKey);
  return result?.value || null;
};

/** Alias for buildVfsRoutingToken. */
export const resolveVfsRoutingToken = buildVfsRoutingToken;
