import fs from 'node:fs';
import path from 'node:path';
import { MAX_JSON_BYTES } from '../constants.js';
import { existsOrBak, resolvePathOrBak } from '../fs.js';
import { readJsonFile } from '../json.js';
import { createPackedChecksumValidator } from '../checksum.js';
import { decodeVarint64List } from '../varint.js';
import {
  loadPiecesManifest,
  resolveManifestArtifactSources,
  resolveManifestBinaryColumnarPreference
} from '../manifest.js';
import {
  DEFAULT_PACKED_BLOCK_SIZE,
  decodePackedOffsets,
  unpackTfPostingSlice,
  unpackTfPostings
} from '../../packed-postings.js';
import { joinPathSafe } from '../../path-normalize.js';
import { formatHash64 } from '../../token-id.js';
import { readJsonFileCached, resolveArtifactMetaEnvelope } from './shared.js';
import {
  assertSupportedBinaryColumnarMeta,
  coerceStrictNonNegativeSafeInt,
  loadBinaryColumnarRowPayloads,
  resolveSafeLayoutPath,
  resolveStrictNonNegativeSafeInt,
  shouldDegradeUnsupportedMeta
} from './binary-columnar.js';

/**
 * Decode varint delta/tf pairs into `[docId, tf]` postings.
 *
 * @param {Uint8Array|Buffer} payload
 * @returns {Array<[number, number]>}
 */
const decodePostingPairsVarint = (payload) => {
  const values = decodeVarint64List(payload);
  if (values.length % 2 !== 0) {
    throw new Error('Invalid token_postings binary-columnar payload: odd varint pair count');
  }
  const postings = [];
  let docId = 0;
  for (let i = 0; i < values.length; i += 2) {
    const delta = coerceStrictNonNegativeSafeInt(values[i]);
    const tf = coerceStrictNonNegativeSafeInt(values[i + 1]);
    if (delta == null || tf == null) {
      throw new Error('Invalid token_postings binary-columnar payload: non-integer delta/tf');
    }
    docId = resolveStrictNonNegativeSafeInt(docId + delta, 'token_postings decoded docId');
    postings.push([docId, tf]);
  }
  return postings;
};

const assertTokenPostingsCardinalityInvariant = ({
  count,
  vocab,
  postings,
  vocabIds,
  contextLabel
}) => {
  const diagnostics = [];
  const vocabCount = Array.isArray(vocab) ? vocab.length : 0;
  const postingsCount = Array.isArray(postings) ? postings.length : 0;
  const vocabIdsCount = Array.isArray(vocabIds) ? vocabIds.length : 0;
  if (count !== vocabCount) {
    diagnostics.push(`count=${count} does not match vocab=${vocabCount}`);
  }
  if (postingsCount !== vocabCount) {
    diagnostics.push(`postings=${postingsCount} does not match vocab=${vocabCount}`);
  }
  if (vocabIdsCount > 0 && vocabIdsCount !== vocabCount) {
    diagnostics.push(`vocabIds=${vocabIdsCount} does not match vocab=${vocabCount}`);
  }
  if (!diagnostics.length) return;
  const error = new Error(
    `[artifact-io] ${contextLabel} cardinality invariant failed: ${diagnostics.join('; ')}`
  );
  error.code = 'ERR_ARTIFACT_INVALID';
  error.diagnostics = diagnostics;
  throw error;
};

/**
 * Attempt to load `token_postings` from binary-columnar artifacts.
 *
 * @param {string} dir
 * @param {{ maxBytes?: number, enforceDataBudget?: boolean }} [options]
 * @returns {object|null}
 */
const tryLoadTokenPostingsBinaryColumnar = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    enforceDataBudget = true
  } = {}
) => {
  const metaPath = path.join(dir, 'token_postings.binary-columnar.meta.json');
  if (!existsOrBak(metaPath)) return null;
  const metaRaw = readJsonFileCached(resolvePathOrBak(metaPath), { maxBytes });
  try {
    assertSupportedBinaryColumnarMeta(metaRaw, 'token_postings binary-columnar');
  } catch (error) {
    if (shouldDegradeUnsupportedMeta(error)) return null;
    throw error;
  }
  const { fields: meta, arrays } = resolveArtifactMetaEnvelope(metaRaw);
  const vocab = Array.isArray(arrays.vocab) ? arrays.vocab : [];
  const count = meta?.count == null
    ? vocab.length
    : resolveStrictNonNegativeSafeInt(meta.count, 'token_postings binary-columnar count');
  const vocabIds = Array.isArray(arrays.vocabIds) ? arrays.vocabIds : [];
  const dataPath = resolveSafeLayoutPath(
    dir,
    meta?.data,
    'token_postings.binary-columnar.bin',
    'token_postings binary-columnar data'
  );
  const offsetsPath = resolveSafeLayoutPath(
    dir,
    meta?.offsets,
    'token_postings.binary-columnar.offsets.bin',
    'token_postings binary-columnar offsets'
  );
  const lengthsPath = resolveSafeLayoutPath(
    dir,
    meta?.lengths,
    'token_postings.binary-columnar.lengths.varint',
    'token_postings binary-columnar lengths'
  );
  const payloads = loadBinaryColumnarRowPayloads({
    dataPath,
    offsetsPath,
    lengthsPath,
    count,
    maxBytes,
    enforceDataBudget
  });
  if (!payloads) return null;
  const postings = new Array(payloads.length);
  for (let i = 0; i < payloads.length; i += 1) {
    postings[i] = decodePostingPairsVarint(payloads[i]);
  }
  assertTokenPostingsCardinalityInvariant({
    count,
    vocab,
    postings,
    vocabIds,
    contextLabel: 'token_postings binary-columnar'
  });
  const docLengths = Array.isArray(arrays.docLengths) ? arrays.docLengths : [];
  return {
    ...meta,
    vocab,
    ...(vocabIds.length ? { vocabIds } : {}),
    postings,
    docLengths
  };
};

/**
 * Load sparse token postings from manifest-selected formats.
 *
 * Supported formats:
 * - JSON object (`token_postings.json`)
 * - packed binary + offsets + meta
 * - sharded JSON parts
 * - binary-columnar postings
 *
 * @param {string} dir
 * @param {{
 *   maxBytes?: number,
 *   manifest?: object|null,
 *   strict?: boolean,
 *   preferBinaryColumnar?: boolean,
 *   packedWindowTokens?: number,
 *   packedWindowBytes?: number,
 *   enforceBinaryDataBudget?: boolean
 * }} [options]
 * @returns {any}
 */
export const loadTokenPostings = (
  dir,
  {
    maxBytes = MAX_JSON_BYTES,
    manifest = null,
    strict = true,
    preferBinaryColumnar = true,
    packedWindowTokens = 1024,
    packedWindowBytes = 16 * 1024 * 1024,
    enforceBinaryDataBudget = true
  } = {}
) => {
  const resolvedManifest = manifest || loadPiecesManifest(dir, { maxBytes, strict });
  const useBinaryColumnar = resolveManifestBinaryColumnarPreference(resolvedManifest, {
    fallback: preferBinaryColumnar
  });
  const resolveManifestPiece = (targetPath, expectedName = null) => {
    if (!resolvedManifest || typeof resolvedManifest !== 'object') return null;
    const pieces = Array.isArray(resolvedManifest.pieces) ? resolvedManifest.pieces : [];
    if (!pieces.length) return null;
    const resolvedPath = path.resolve(targetPath);
    const relPath = path.relative(path.resolve(dir), resolvedPath).split(path.sep).join('/');
    return pieces.find((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      if (entry.path !== relPath) return false;
      if (expectedName && entry.name !== expectedName) return false;
      return true;
    }) || null;
  };

  const createManifestChecksumValidator = (targetPath, expectedName, label) => {
    const piece = resolveManifestPiece(targetPath, expectedName);
    if (!piece || typeof piece.checksum !== 'string' || !piece.checksum.includes(':')) return null;
    try {
      return createPackedChecksumValidator({ checksum: piece.checksum }, { label });
    } catch {
      return null;
    }
  };

  /**
   * Load packed token postings with bounded decode windows to cap peak RSS.
   *
   * @param {string} packedPath
   * @returns {any}
   */
  const loadPacked = (packedPath) => {
    const metaPath = path.join(dir, 'token_postings.packed.meta.json');
    if (!existsOrBak(packedPath)) {
      throw new Error('Missing token_postings packed data');
    }
    if (!existsOrBak(metaPath)) {
      throw new Error('Missing token_postings packed meta');
    }
    const resolvedPackedPath = resolvePathOrBak(packedPath);
    const resolvedMetaPath = resolvePathOrBak(metaPath);
    const metaRaw = readJsonFileCached(resolvedMetaPath, { maxBytes });
    const fields = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
    const arrays = metaRaw?.arrays && typeof metaRaw.arrays === 'object' ? metaRaw.arrays : metaRaw;
    const vocab = Array.isArray(arrays?.vocab) ? arrays.vocab : [];
    const vocabIds = Array.isArray(arrays?.vocabIds) ? arrays.vocabIds : [];
    const docLengths = Array.isArray(arrays?.docLengths) ? arrays.docLengths : [];
    const offsetsName = typeof fields?.offsets === 'string'
      ? fields.offsets
      : 'token_postings.packed.offsets.bin';
    const offsetsPath = joinPathSafe(dir, [offsetsName]);
    if (!offsetsPath) {
      throw new Error('Invalid token_postings packed offsets path');
    }
    if (!existsOrBak(offsetsPath)) {
      throw new Error('Missing token_postings packed offsets');
    }
    const resolvedOffsetsPath = resolvePathOrBak(offsetsPath);
    const offsetsBuffer = fs.readFileSync(resolvedOffsetsPath);
    const offsetsChecksum = createManifestChecksumValidator(
      offsetsPath,
      'token_postings_offsets',
      'token_postings offsets'
    );
    if (offsetsChecksum) {
      offsetsChecksum.update(offsetsBuffer);
      offsetsChecksum.verify();
    }
    const offsets = decodePackedOffsets(offsetsBuffer);
    const blockSize = Number.isFinite(Number(fields?.blockSize))
      ? Math.max(1, Math.floor(Number(fields.blockSize)))
      : DEFAULT_PACKED_BLOCK_SIZE;
    const totalTokens = Math.max(0, offsets.length - 1);
    const postings = new Array(totalTokens);
    const resolvedWindowTokens = Number.isFinite(Number(packedWindowTokens))
      ? Math.max(1, Math.floor(Number(packedWindowTokens)))
      : 1024;
    const resolvedWindowBytes = Number.isFinite(Number(packedWindowBytes))
      ? Math.max(1024, Math.floor(Number(packedWindowBytes)))
      : (16 * 1024 * 1024);
    const packedChecksum = createManifestChecksumValidator(
      packedPath,
      'token_postings',
      'token_postings packed'
    );
    const readWindow = (fd, startToken, endToken) => {
      const byteStart = offsets[startToken] ?? 0;
      const byteEnd = offsets[endToken] ?? byteStart;
      const byteLen = Math.max(0, byteEnd - byteStart);
      if (!byteLen) {
        for (let i = startToken; i < endToken; i += 1) {
          postings[i] = [];
        }
        return;
      }
      const windowBuffer = Buffer.allocUnsafe(byteLen);
      const bytesRead = fs.readSync(fd, windowBuffer, 0, byteLen, byteStart);
      if (bytesRead < byteLen) {
        throw new Error('Packed token_postings truncated');
      }
      if (packedChecksum) {
        packedChecksum.update(windowBuffer, 0, bytesRead);
      }
      for (let i = startToken; i < endToken; i += 1) {
        const localStart = (offsets[i] ?? 0) - byteStart;
        const localEnd = (offsets[i + 1] ?? localStart) - byteStart;
        if (localEnd <= localStart) {
          postings[i] = [];
          continue;
        }
        postings[i] = unpackTfPostingSlice(windowBuffer.subarray(localStart, localEnd), { blockSize });
      }
    };
    const fallbackFullRead = () => {
      const buffer = fs.readFileSync(resolvedPackedPath);
      const fallbackChecksum = createManifestChecksumValidator(
        packedPath,
        'token_postings',
        'token_postings packed'
      );
      if (fallbackChecksum) {
        fallbackChecksum.update(buffer);
        fallbackChecksum.verify();
      }
      return unpackTfPostings(buffer, offsets, { blockSize });
    };
    let fd = null;
    try {
      fd = fs.openSync(resolvedPackedPath, 'r');
      let startToken = 0;
      while (startToken < totalTokens) {
        let endToken = Math.min(totalTokens, startToken + resolvedWindowTokens);
        // Keep each decode window bounded in bytes for lower peak RSS.
        while (endToken < totalTokens) {
          const candidateBytes = (offsets[endToken] ?? 0) - (offsets[startToken] ?? 0);
          if (candidateBytes >= resolvedWindowBytes) break;
          endToken += 1;
        }
        if (endToken <= startToken) {
          endToken = Math.min(totalTokens, startToken + 1);
        }
        readWindow(fd, startToken, endToken);
        startToken = endToken;
      }
      if (packedChecksum) packedChecksum.verify();
    } catch {
      return {
        ...fields,
        avgDocLen: Number.isFinite(fields?.avgDocLen) ? fields.avgDocLen : (
          docLengths.length
            ? docLengths.reduce((sum, len) => sum + (Number(len) || 0), 0) / docLengths.length
            : 0
        ),
        totalDocs: Number.isFinite(fields?.totalDocs) ? fields.totalDocs : docLengths.length,
        vocab,
        ...(vocabIds.length ? { vocabIds } : {}),
        postings: fallbackFullRead(),
        docLengths
      };
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch {}
      }
    }
    const avgDocLen = Number.isFinite(fields?.avgDocLen) ? fields.avgDocLen : (
      docLengths.length
        ? docLengths.reduce((sum, len) => sum + (Number(len) || 0), 0) / docLengths.length
        : 0
    );
    return {
      ...fields,
      avgDocLen,
      totalDocs: Number.isFinite(fields?.totalDocs) ? fields.totalDocs : docLengths.length,
      vocab,
      ...(vocabIds.length ? { vocabIds } : {}),
      postings,
      docLengths
    };
  };

  /**
   * Merge sharded token-postings pieces into a single normalized payload.
   *
   * @param {any} meta
   * @param {string[]} shardPaths
   * @param {string} shardsDir
   * @returns {any}
   */
  const loadSharded = (meta, shardPaths, shardsDir) => {
    if (!Array.isArray(shardPaths) || shardPaths.length === 0) {
      throw new Error(`Missing token_postings shard files in ${shardsDir}`);
    }
    const vocab = [];
    const vocabIds = [];
    const postings = [];
    const pushChunked = (target, items) => {
      const CHUNK = 4096;
      for (let i = 0; i < items.length; i += CHUNK) {
        target.push(...items.slice(i, i + CHUNK));
      }
    };
    for (const shardPath of shardPaths) {
      const shard = readJsonFile(shardPath, { maxBytes });
      const shardVocab = Array.isArray(shard?.vocab)
        ? shard.vocab
        : (Array.isArray(shard?.arrays?.vocab) ? shard.arrays.vocab : []);
      const shardVocabIds = Array.isArray(shard?.vocabIds)
        ? shard.vocabIds
        : (Array.isArray(shard?.arrays?.vocabIds) ? shard.arrays.vocabIds : []);
      const shardPostings = Array.isArray(shard?.postings)
        ? shard.postings
        : (Array.isArray(shard?.arrays?.postings) ? shard.arrays.postings : []);
      if (shardVocab.length) pushChunked(vocab, shardVocab);
      if (shardVocabIds.length) pushChunked(vocabIds, shardVocabIds);
      if (shardPostings.length) pushChunked(postings, shardPostings);
    }
    const docLengths = Array.isArray(meta?.docLengths)
      ? meta.docLengths
      : (Array.isArray(meta?.arrays?.docLengths) ? meta.arrays.docLengths : []);
    return {
      ...meta,
      vocab,
      ...(vocabIds.length ? { vocabIds } : {}),
      postings,
      docLengths
    };
  };
  if (useBinaryColumnar) {
    const binary = tryLoadTokenPostingsBinaryColumnar(dir, {
      maxBytes,
      enforceDataBudget: enforceBinaryDataBudget
    });
    if (binary) return binary;
  }
  const sources = resolveManifestArtifactSources({
    dir,
    manifest: resolvedManifest,
    name: 'token_postings',
    strict,
    maxBytes
  });
  if (!sources?.paths?.length) {
    throw new Error('Missing manifest entry for token_postings');
  }
  if (sources.format === 'json') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous JSON sources for token_postings');
    }
    return readJsonFile(sources.paths[0], { maxBytes });
  }
  if (sources.format === 'packed') {
    if (sources.paths.length > 1) {
      throw new Error('Ambiguous packed sources for token_postings');
    }
    return loadPacked(sources.paths[0]);
  }
  if (sources.format === 'sharded') {
    return loadSharded(sources.meta || {}, sources.paths, path.join(dir, 'token_postings.shards'));
  }
  if (sources.format === 'binary-columnar') {
    const binary = tryLoadTokenPostingsBinaryColumnar(dir, {
      maxBytes,
      enforceDataBudget: enforceBinaryDataBudget
    });
    if (binary) return binary;
  }
  throw new Error(`Unsupported token_postings format: ${sources.format}`);
};
