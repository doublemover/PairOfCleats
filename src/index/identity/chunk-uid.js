import { checksumString } from '../../shared/hash.js';
import { toPosix } from '../../shared/files.js';
import { normalizeEol } from '../../shared/eol.js';
import { isCanonicalChunkUid } from '../../shared/identity.js';

export const PRE_CONTEXT_CHARS = 128;
export const POST_CONTEXT_CHARS = 128;
export const ESCALATION_CONTEXT_CHARS = 1024;
export const MAX_COLLISION_PASSES = 2;

export const normalizeForUid = (value) => normalizeEol(value || '');

const normalizeHash = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
};

const hashComponent = async (label, text, { allowEmpty = false } = {}) => {
  const normalized = normalizeForUid(text);
  if (!normalized && !allowEmpty) return null;
  const hash = await checksumString(`${label}\0${normalized || ''}`);
  return normalizeHash(hash?.value);
};

export const buildIdentityVirtualPath = ({ fileRelPath, segmentUid }) => {
  const base = toPosix(fileRelPath || '');
  if (!segmentUid) return base;
  return `${base}#seg:${segmentUid}`;
};

export const computeSegmentUid = async ({ segmentText, segmentType, languageId }) => {
  if (!segmentText) return null;
  const normalized = normalizeForUid(segmentText);
  if (!normalized) return null;
  const segKey = `seg\0${segmentType || ''}\0${languageId || ''}\0${normalized}`;
  const hash = await checksumString(segKey);
  const value = normalizeHash(hash?.value);
  return value ? `segu:v1:${value}` : null;
};

export const computeChunkUid = async ({
  namespaceKey = 'repo',
  virtualPath,
  fileText,
  startOffset,
  endOffset,
  langSalt = null,
  spanSalt = null,
  preContextChars = PRE_CONTEXT_CHARS,
  postContextChars = POST_CONTEXT_CHARS
}) => {
  const safeNamespace = String(namespaceKey || 'repo');
  const safePath = String(virtualPath || '');
  const text = typeof fileText === 'string' ? fileText : '';
  const start = Number.isFinite(startOffset) ? Math.max(0, startOffset) : 0;
  const end = Number.isFinite(endOffset) ? Math.max(start, endOffset) : start;
  const spanRaw = text.slice(start, end);
  const preRaw = text.slice(Math.max(0, start - preContextChars), start);
  const postRaw = text.slice(end, Math.min(text.length, end + postContextChars));
  const spanLabel = spanSalt ? `span:${spanSalt}` : 'span';
  const spanHash = await hashComponent(spanLabel, spanRaw, { allowEmpty: true });
  const preHash = await hashComponent('pre', preRaw);
  const postHash = await hashComponent('post', postRaw);
  let base = `ck64:v1:${safeNamespace}:${safePath}`;
  if (langSalt) base += `:${langSalt}`;
  base += `:${spanHash || ''}`;
  if (preHash) base += `:${preHash}`;
  if (postHash) base += `:${postHash}`;
  if (!isCanonicalChunkUid(base)) {
    throw new Error('Generated chunkUid violates canonical grammar');
  }
  return {
    chunkUid: base,
    spanHash,
    preHash,
    postHash
  };
};

const buildCollisionKey = (chunk, fileRelPath) => [
  toPosix(fileRelPath || ''),
  chunk?.segment?.segmentUid || '',
  Number.isFinite(chunk?.start) ? chunk.start : '',
  Number.isFinite(chunk?.end) ? chunk.end : '',
  chunk?.kind || '',
  chunk?.name || ''
].join('|');

const buildCollisionEntropySalt = (chunk) => {
  const chunkId = chunk?.chunkId || chunk?.metaV2?.chunkId || '';
  const startLine = Number.isFinite(chunk?.startLine) ? Math.floor(chunk.startLine) : '';
  const endLine = Number.isFinite(chunk?.endLine) ? Math.floor(chunk.endLine) : '';
  const segmentUid = chunk?.segment?.segmentUid || '';
  const kind = chunk?.kind || '';
  const name = chunk?.name || '';
  return `${chunkId}:${startLine}:${endLine}:${segmentUid}:${kind}:${name}`;
};

const formatHashForMeta = (value) => (value ? `xxh64:${value}` : null);

const assignChunkIdentity = (chunk, virtualPath, computed, { collisionOf = null } = {}) => {
  if (!chunk) return;
  chunk.chunkUid = computed?.chunkUid || chunk.chunkUid || null;
  chunk.virtualPath = virtualPath || chunk.virtualPath || null;
  if (chunk.segment && typeof chunk.segment === 'object') {
    chunk.segment.virtualPath = virtualPath || chunk.segment.virtualPath || null;
  }
  chunk.identity = {
    chunkUidAlgoVersion: 'v1',
    spanHash: formatHashForMeta(computed?.spanHash),
    preHash: formatHashForMeta(computed?.preHash),
    postHash: formatHashForMeta(computed?.postHash),
    collisionOf: collisionOf || null
  };
};

const findCollisionGroups = (chunks) => {
  const groups = new Map();
  for (const chunk of chunks) {
    const uid = chunk?.chunkUid;
    if (!uid) continue;
    if (!groups.has(uid)) groups.set(uid, []);
    groups.get(uid).push(chunk);
  }
  return Array.from(groups.values()).filter((group) => group.length > 1);
};

export const assignChunkUids = async ({
  chunks,
  fileText,
  fileRelPath,
  namespaceKey = 'repo',
  strict = true,
  log = null
}) => {
  if (!Array.isArray(chunks) || !chunks.length) return { collisions: null };
  const safePath = toPosix(fileRelPath || '');
  const metrics = {
    collisionGroups: 0,
    entropy: 0,
    escalated: 0,
    ordinal: 0,
    maxGroupSize: 0
  };
  const computeForChunk = async (chunk, contextChars, { spanSalt = null } = {}) => {
    const segmentUid = chunk?.segment?.segmentUid || null;
    if (chunk?.segment && !segmentUid && strict) {
      throw new Error(`Missing segmentUid for chunk in ${safePath}`);
    }
    const virtualPath = buildIdentityVirtualPath({ fileRelPath: safePath, segmentUid });
    const computed = await computeChunkUid({
      namespaceKey,
      virtualPath,
      fileText,
      startOffset: chunk?.start,
      endOffset: chunk?.end,
      langSalt: chunk?.segment?.languageId || null,
      spanSalt,
      preContextChars: contextChars.pre,
      postContextChars: contextChars.post
    });
    assignChunkIdentity(chunk, virtualPath, computed);
    return computed;
  };

  for (const chunk of chunks) {
    await computeForChunk(chunk, { pre: PRE_CONTEXT_CHARS, post: POST_CONTEXT_CHARS });
  }

  let collisionGroups = findCollisionGroups(chunks);
  if (collisionGroups.length) {
    metrics.collisionGroups = collisionGroups.length;
    metrics.maxGroupSize = Math.max(metrics.maxGroupSize, ...collisionGroups.map((g) => g.length));
    for (const group of collisionGroups) {
      for (const chunk of group) {
        await computeForChunk(
          chunk,
          { pre: PRE_CONTEXT_CHARS, post: POST_CONTEXT_CHARS },
          { spanSalt: buildCollisionEntropySalt(chunk) }
        );
      }
    }
    metrics.entropy += collisionGroups.length;
    collisionGroups = findCollisionGroups(chunks);
  }
  if (collisionGroups.length) {
    metrics.maxGroupSize = Math.max(metrics.maxGroupSize, ...collisionGroups.map((g) => g.length));
    for (const group of collisionGroups) {
      for (const chunk of group) {
        await computeForChunk(
          chunk,
          { pre: ESCALATION_CONTEXT_CHARS, post: ESCALATION_CONTEXT_CHARS },
          { spanSalt: buildCollisionEntropySalt(chunk) }
        );
      }
    }
    metrics.escalated += collisionGroups.length;
    collisionGroups = findCollisionGroups(chunks);
  }

  if (collisionGroups.length) {
    metrics.ordinal += collisionGroups.length;
    metrics.maxGroupSize = Math.max(metrics.maxGroupSize, ...collisionGroups.map((g) => g.length));
    for (const group of collisionGroups) {
      group.sort((a, b) => {
        const keyA = buildCollisionKey(a, safePath);
        const keyB = buildCollisionKey(b, safePath);
        if (keyA !== keyB) return keyA.localeCompare(keyB);
        return String(a.chunkUid || '').localeCompare(String(b.chunkUid || ''));
      });
      group.forEach((chunk, index) => {
        const base = chunk.chunkUid;
        const ordinal = index + 1;
        chunk.chunkUid = `${base}:ord${ordinal}`;
        if (!isCanonicalChunkUid(chunk.chunkUid)) {
          throw new Error(`Collision-resolved chunkUid violates canonical grammar for ${safePath}`);
        }
        if (chunk.identity) {
          chunk.identity.collisionOf = base;
        } else {
          chunk.identity = {
            chunkUidAlgoVersion: 'v1',
            spanHash: null,
            preHash: null,
            postHash: null,
            collisionOf: base
          };
        }
      });
    }
  }

  // Note: collisions that are resolved by the escalation pass are expected for
  // duplicated code patterns (common in Swift extensions/protocol conformances).
  // Only emit a log line when we had to fall back to the ordinal suffix step,
  // since that indicates the stronger stability trade-off (uids become order
  // dependent within the file).
  if (log && metrics.ordinal) {
    log(`[identity] chunkUid collisions in ${safePath}: groups=${metrics.collisionGroups}, ordinals=${metrics.ordinal}`);
  }

  return { collisions: metrics };
};
