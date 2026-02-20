import { toPosix } from '../../../shared/files.js';
import { LANGUAGE_ID_EXT } from '../../segments/config.js';
import { VFS_HASH_PREFIX, VFS_PREFIX } from './constants.js';

const encodeContainerPath = (value) => {
  const rawPath = value == null ? '' : String(value);
  const posixPath = toPosix(rawPath);
  return posixPath.replace(/%/g, '%25').replace(/#/g, '%23');
};

export const normalizeLanguageId = (value, fallback = null) => {
  if (!value) return fallback;
  const text = String(value).trim();
  return text ? text.toLowerCase() : fallback;
};

/**
 * Resolve the effective extension for a virtual document.
 * @param {{languageId?:string|null,containerExt?:string|null}} input
 * @returns {string}
 */
export const resolveEffectiveExt = ({ languageId, containerExt }) => {
  if (languageId && LANGUAGE_ID_EXT.has(languageId)) {
    return LANGUAGE_ID_EXT.get(languageId);
  }
  return containerExt || '';
};

/**
 * Build a deterministic VFS virtual path.
 * @param {{containerPath:string,segmentUid?:string|null,effectiveExt?:string|null}} input
 * @returns {string}
 */
export const buildVfsVirtualPath = ({ containerPath, segmentUid, effectiveExt }) => {
  const encoded = encodeContainerPath(containerPath);
  if (!segmentUid) return `${VFS_PREFIX}${encoded}`;
  return `${VFS_PREFIX}${encoded}#seg:${segmentUid}${effectiveExt || ''}`;
};

/**
 * Build a content-addressed VFS virtual path.
 * @param {{docHash:string,effectiveExt?:string|null}} input
 * @returns {string|null}
 */
export const buildVfsHashVirtualPath = ({ docHash, effectiveExt }) => {
  if (!docHash) return null;
  return `${VFS_HASH_PREFIX}${docHash}${effectiveExt || ''}`;
};

/**
 * Resolve the VFS virtual path based on routing settings.
 * @param {{containerPath:string,segmentUid?:string|null,effectiveExt?:string|null,docHash?:string|null,hashRouting?:boolean}} input
 * @returns {string}
 */
export const resolveVfsVirtualPath = ({
  containerPath,
  segmentUid,
  effectiveExt,
  docHash = null,
  hashRouting = false
}) => {
  if (hashRouting) {
    const hashPath = buildVfsHashVirtualPath({ docHash, effectiveExt });
    if (hashPath) return hashPath;
  }
  return buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt });
};
