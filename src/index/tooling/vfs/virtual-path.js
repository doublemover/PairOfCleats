import { toPosix } from '../../../shared/file-paths.js';
import { createHash } from 'node:crypto';
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
  if (containerExt === '.jsx' && (!languageId || ['javascript', 'jsx'].includes(languageId))) return '.jsx';
  if (containerExt === '.tsx' && (!languageId || ['typescript', 'tsx'].includes(languageId))) return '.tsx';
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
export const buildVfsVirtualPath = ({ containerPath, segmentUid, effectiveExt, segmentStart = null, segmentEnd = null }) => {
  const encoded = encodeContainerPath(containerPath);
  if (!segmentUid) return `${VFS_PREFIX}${encoded}`;
  const occurrence = Number.isFinite(segmentStart) && Number.isFinite(segmentEnd) ? `#at:${segmentStart}-${segmentEnd}` : '';
  return `${VFS_PREFIX}${encoded}#seg:${segmentUid}${occurrence}${effectiveExt || ''}`;
};

/** Admit only canonical path-routed identities, preserving VFS case policy. */
export const parseVfsVirtualPathIdentity = virtualPath => {
  if (typeof virtualPath !== 'string' || !virtualPath.startsWith(VFS_PREFIX)
    || virtualPath.startsWith(VFS_HASH_PREFIX) || virtualPath.includes('\0')) return null;
  const separator = virtualPath.indexOf('#seg:');
  const containerVirtualPath = separator < 0 ? virtualPath : virtualPath.slice(0, separator);
  const encoded = containerVirtualPath.slice(VFS_PREFIX.length);
  const containerPath = encoded.replace(/%25|%23/g, value => value === '%25' ? '%' : '#');
  if (!containerPath || containerPath.startsWith('/') || /^[A-Za-z]:/.test(containerPath)
    || containerPath.split('/').some(part => !part || part === '.' || part === '..')
    || buildVfsVirtualPath({ containerPath }) !== containerVirtualPath) return null;
  if (separator < 0) return { scope: 'container', containerPath, containerVirtualPath, virtualPath };
  const segment = /^([^#]+)#at:(\d+)-(\d+)(\.[^/#]*)?$/.exec(virtualPath.slice(separator + 5));
  if (!segment) return null;
  const [, segmentUid, start, end, effectiveExt = ''] = segment;
  const segmentStart = Number(start), segmentEnd = Number(end);
  if (!Number.isSafeInteger(segmentStart) || !Number.isSafeInteger(segmentEnd) || segmentStart > segmentEnd
    || buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt, segmentStart, segmentEnd }) !== virtualPath) return null;
  return { scope: 'segment', containerPath, containerVirtualPath, virtualPath, segmentUid, segmentStart, segmentEnd, effectiveExt };
};

/**
 * Build a content-addressed path scoped to one semantic source origin.
 * @param {{docHash:string,containerPath:string,segmentUid?:string|null,languageId?:string|null,effectiveExt?:string|null}} input
 * @returns {string|null}
 */
export const buildVfsHashVirtualPath = ({ docHash, containerPath, segmentUid, languageId, effectiveExt, segmentStart = null, segmentEnd = null }) => {
  if (!docHash || typeof containerPath !== 'string' || !containerPath) return null;
  const origin = JSON.stringify([toPosix(containerPath), segmentUid || null,
    normalizeLanguageId(languageId), effectiveExt || '',
    segmentUid && Number.isFinite(segmentStart) ? segmentStart : null,
    segmentUid && Number.isFinite(segmentEnd) ? segmentEnd : null]);
  const originHash = createHash('sha256').update(origin).digest('hex');
  return `${VFS_HASH_PREFIX}${docHash}/${originHash}${effectiveExt || ''}`;
};

/**
 * Resolve the VFS virtual path based on routing settings.
 * @param {{containerPath:string,segmentUid?:string|null,languageId?:string|null,effectiveExt?:string|null,docHash?:string|null,hashRouting?:boolean}} input
 * @returns {string}
 */
export const resolveVfsVirtualPath = ({
  containerPath,
  segmentUid,
  languageId = null,
  effectiveExt,
  docHash = null,
  hashRouting = false,
  segmentStart = null,
  segmentEnd = null
}) => {
  if (hashRouting) {
    const hashPath = buildVfsHashVirtualPath({ docHash, containerPath, segmentUid, languageId, effectiveExt, segmentStart, segmentEnd });
    if (hashPath) return hashPath;
  }
  return buildVfsVirtualPath({ containerPath, segmentUid, effectiveExt, segmentStart, segmentEnd });
};
