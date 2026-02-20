import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { TOKEN_ID_META } from '../../../shared/token-id.js';
import { createTempPath, replaceFile } from '../../../shared/json-stream/atomic.js';
import { DEFAULT_PACKED_BLOCK_SIZE, encodePackedOffsets, packTfPostings } from '../../../shared/packed-postings.js';
import { encodeVarint64List } from '../../../shared/artifact-io/varint.js';
import { encodeBinaryRowFrames } from '../../../shared/artifact-io/binary-columnar.js';
import { estimatePostingsBytes, formatBytes } from './helpers.js';

const normalizeTokenPostingsFormat = (value, artifactMode) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'packed' || raw === 'json' || raw === 'sharded' || raw === 'auto') return raw;
  if (artifactMode === 'json') return 'json';
  if (artifactMode === 'sharded') return 'sharded';
  return 'auto';
};

const normalizeShardSize = (value, fallback = 50000) => {
  if (Number.isFinite(Number(value))) {
    return Math.max(1, Math.floor(Number(value)));
  }
  return Math.max(1, Math.floor(Number(fallback) || 50000));
};

const resolveTargetShardSize = (shardTargetBytes, avgBytes, fallback) => {
  if (!Number.isFinite(shardTargetBytes) || shardTargetBytes <= 0) return fallback;
  if (!Number.isFinite(avgBytes) || avgBytes <= 0) return fallback;
  const target = Math.floor(shardTargetBytes / avgBytes);
  if (!Number.isFinite(target) || target <= 0) return fallback;
  return Math.max(1, target);
};

const createArrayWindowIterable = (values, start, end) => ({
  [Symbol.iterator]: function* iterateWindow() {
    for (let index = start; index < end; index += 1) {
      yield values[index];
    }
  }
});

export function resolveTokenPostingsPlan({
  artifactMode,
  tokenPostingsFormatConfig,
  tokenPostingsShardSize,
  tokenPostingsShardThreshold,
  tokenPostingsBinaryColumnar = false,
  tokenPostingsPackedAutoThresholdBytes = null,
  postings,
  maxJsonBytes,
  maxJsonBytesSoft,
  shardTargetBytes,
  log
}) {
  const tokenPostingsFormat = normalizeTokenPostingsFormat(tokenPostingsFormatConfig, artifactMode);
  let resolvedShardSize = normalizeShardSize(tokenPostingsShardSize);
  let tokenPostingsUseShards = tokenPostingsFormat === 'sharded'
    || (tokenPostingsFormat === 'auto'
      && postings.tokenVocab.length >= tokenPostingsShardThreshold);
  const tokenPostingsEstimate = estimatePostingsBytes(
    postings.tokenVocab,
    postings.tokenPostingsList
  );
  if (tokenPostingsFormat === 'packed') {
    tokenPostingsUseShards = false;
  }
  if (tokenPostingsEstimate) {
    if (tokenPostingsEstimate.estimatedBytes > maxJsonBytesSoft) {
      tokenPostingsUseShards = tokenPostingsFormat !== 'packed';
      const targetShardSize = resolveTargetShardSize(
        shardTargetBytes,
        tokenPostingsEstimate.avgBytes,
        resolvedShardSize
      );
      resolvedShardSize = Math.max(1, Math.min(resolvedShardSize, targetShardSize));
      log(
        `Token postings estimate ~${formatBytes(tokenPostingsEstimate.estimatedBytes)}; ` +
        `using sharded output to stay under ${formatBytes(maxJsonBytes)}.`
      );
    } else if (tokenPostingsUseShards) {
      const targetShardSize = resolveTargetShardSize(
        shardTargetBytes,
        tokenPostingsEstimate.avgBytes,
        resolvedShardSize
      );
      resolvedShardSize = Math.max(1, Math.min(resolvedShardSize, targetShardSize));
    }
    const packedThresholdRaw = Number(tokenPostingsPackedAutoThresholdBytes);
    const packedThreshold = Number.isFinite(packedThresholdRaw) && packedThresholdRaw > 0
      ? Math.floor(packedThresholdRaw)
      : null;
    if (
      tokenPostingsFormat === 'auto'
      && tokenPostingsBinaryColumnar === true
      && Number.isFinite(packedThreshold)
      && tokenPostingsEstimate.estimatedBytes >= packedThreshold
    ) {
      tokenPostingsUseShards = false;
      log(
        `Token postings estimate ~${formatBytes(tokenPostingsEstimate.estimatedBytes)}; ` +
        `switching auto format to packed (threshold ${formatBytes(packedThreshold)}).`
      );
      return {
        tokenPostingsFormat: 'packed',
        tokenPostingsUseShards,
        tokenPostingsShardSize: resolvedShardSize,
        tokenPostingsBinaryColumnar: tokenPostingsBinaryColumnar === true,
        tokenPostingsEstimate
      };
    }
  }
  return {
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsShardSize: resolvedShardSize,
    tokenPostingsBinaryColumnar: tokenPostingsBinaryColumnar === true,
    tokenPostingsEstimate
  };
}

const encodePostingPairs = (posting) => {
  const list = Array.isArray(posting) ? posting : [];
  if (!list.length) return Buffer.alloc(0);
  const values = [];
  let prevDoc = 0;
  for (const entry of list) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const docIdRaw = Number(entry[0]);
    const tfRaw = Number(entry[1]);
    if (!Number.isFinite(docIdRaw) || !Number.isFinite(tfRaw)) continue;
    const docId = Math.max(0, Math.floor(docIdRaw));
    const tf = Math.max(0, Math.floor(tfRaw));
    const delta = Math.max(0, docId - prevDoc);
    values.push(delta, tf);
    prevDoc = docId;
  }
  return encodeVarint64List(values);
};

export async function enqueueTokenPostingsArtifacts({
  outDir,
  postings,
  state,
  tokenPostingsFormat,
  tokenPostingsUseShards,
  tokenPostingsShardSize,
  tokenPostingsBinaryColumnar = false,
  tokenPostingsCompression,
  writePriority = 0,
  tokenPostingsEstimatedBytes = null,
  enqueueJsonObject,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) {
  const vocabIds = Array.isArray(postings.tokenVocabIds) ? postings.tokenVocabIds : null;
  const tokenIdMeta = vocabIds ? TOKEN_ID_META : null;
  const writePackedTokenPostings = async () => {
    const packedPath = path.join(outDir, 'token_postings.packed.bin');
    const offsetsPath = path.join(outDir, 'token_postings.packed.offsets.bin');
    const metaPath = path.join(outDir, 'token_postings.packed.meta.json');
    addPieceFile({
      type: 'postings',
      name: 'token_postings',
      format: 'packed',
      count: postings.tokenVocab.length
    }, packedPath);
    addPieceFile({
      type: 'postings',
      name: 'token_postings_offsets',
      format: 'binary'
    }, offsetsPath);
    addPieceFile({ type: 'postings', name: 'token_postings_meta', format: 'json' }, metaPath);
    enqueueWrite(
      formatArtifactLabel(packedPath),
      async () => {
        const packed = packTfPostings(postings.tokenPostingsList, {
          blockSize: DEFAULT_PACKED_BLOCK_SIZE
        });
        const offsetsBuffer = encodePackedOffsets(packed.offsets);
        const packedTemp = createTempPath(packedPath);
        const offsetsTemp = createTempPath(offsetsPath);
        await fs.writeFile(packedTemp, packed.buffer);
        await fs.writeFile(offsetsTemp, offsetsBuffer);
        await replaceFile(packedTemp, packedPath);
        await replaceFile(offsetsTemp, offsetsPath);
        await writeJsonObjectFile(metaPath, {
          fields: {
            avgDocLen: postings.avgDocLen,
            totalDocs: state.docLengths.length,
            format: 'packed',
            encoding: 'delta-varint',
            blockSize: packed.blockSize,
            vocabCount: postings.tokenVocab.length,
            offsets: path.basename(offsetsPath),
            ...(tokenIdMeta ? { tokenId: tokenIdMeta } : {})
          },
          arrays: {
            vocab: postings.tokenVocab,
            ...(vocabIds ? { vocabIds } : {}),
            docLengths: state.docLengths
          },
          atomic: true
        });
      },
      {
        priority: writePriority,
        estimatedBytes: tokenPostingsEstimatedBytes
      }
    );
  };

  if (tokenPostingsFormat === 'packed') {
    await writePackedTokenPostings();
  } else if (tokenPostingsUseShards) {
    const shardsDir = path.join(outDir, 'token_postings.shards');
    const parts = [];
    const shardPlan = [];
    let shardIndex = 0;
    const resolveJsonExtension = (value) => {
      if (value === 'gzip') return 'json.gz';
      if (value === 'zstd') return 'json.zst';
      return 'json';
    };
    const tokenPostingsExtension = resolveJsonExtension(tokenPostingsCompression);
    for (let i = 0; i < postings.tokenVocab.length; i += tokenPostingsShardSize) {
      const end = Math.min(i + tokenPostingsShardSize, postings.tokenVocab.length);
      const partCount = end - i;
      const partName = `token_postings.part-${String(shardIndex).padStart(5, '0')}.${tokenPostingsExtension}`;
      parts.push(path.posix.join('token_postings.shards', partName));
      shardPlan.push({ start: i, end, partCount, partName });
      addPieceFile({
        type: 'postings',
        name: 'token_postings',
        format: 'json',
        count: partCount,
        compression: tokenPostingsCompression || null
      }, path.join(shardsDir, partName));
      shardIndex += 1;
    }
    const metaPath = path.join(outDir, 'token_postings.meta.json');
    addPieceFile({ type: 'postings', name: 'token_postings_meta', format: 'json' }, metaPath);
    enqueueWrite(
      formatArtifactLabel(shardsDir),
      async () => {
        const tempDir = `${shardsDir}.tmp-${Date.now()}`;
        const backupDir = `${shardsDir}.bak`;
        await fs.rm(tempDir, { recursive: true, force: true });
        await fs.mkdir(tempDir, { recursive: true });
        for (const part of shardPlan) {
          const partPath = path.join(tempDir, part.partName);
          const arrays = {
            vocab: createArrayWindowIterable(postings.tokenVocab, part.start, part.end),
            postings: createArrayWindowIterable(postings.tokenPostingsList, part.start, part.end)
          };
          if (vocabIds) {
            arrays.vocabIds = createArrayWindowIterable(vocabIds, part.start, part.end);
          }
          await writeJsonObjectFile(partPath, {
            arrays,
            compression: tokenPostingsCompression,
            atomic: true
          });
        }
        await fs.rm(backupDir, { recursive: true, force: true });
        try {
          await fs.stat(shardsDir);
          await fs.rename(shardsDir, backupDir);
        } catch {}
        await fs.rename(tempDir, shardsDir);
        await fs.rm(backupDir, { recursive: true, force: true });
        await writeJsonObjectFile(metaPath, {
          fields: {
            avgDocLen: postings.avgDocLen,
            totalDocs: state.docLengths.length,
            format: 'sharded',
            shardSize: tokenPostingsShardSize,
            vocabCount: postings.tokenVocab.length,
            parts,
            compression: tokenPostingsCompression || null,
            ...(tokenIdMeta ? { extensions: { tokenId: tokenIdMeta } } : {})
          },
          arrays: {
            docLengths: state.docLengths
          },
          atomic: true
        });
      },
      {
        priority: writePriority,
        estimatedBytes: tokenPostingsEstimatedBytes
      }
    );
  } else {
    enqueueJsonObject('token_postings', {
      fields: {
        avgDocLen: postings.avgDocLen,
        totalDocs: state.docLengths.length,
        ...(tokenIdMeta ? { tokenId: tokenIdMeta } : {})
      },
      arrays: {
        vocab: postings.tokenVocab,
        ...(vocabIds ? { vocabIds } : {}),
        postings: postings.tokenPostingsList,
        docLengths: state.docLengths
      }
    }, {
      piece: { type: 'postings', name: 'token_postings', count: postings.tokenVocab.length },
      priority: writePriority,
      estimatedBytes: tokenPostingsEstimatedBytes
    });
  }

  const binaryDataPath = path.join(outDir, 'token_postings.binary-columnar.bin');
  const binaryOffsetsPath = path.join(outDir, 'token_postings.binary-columnar.offsets.bin');
  const binaryLengthsPath = path.join(outDir, 'token_postings.binary-columnar.lengths.varint');
  const binaryMetaPath = path.join(outDir, 'token_postings.binary-columnar.meta.json');
  if (tokenPostingsBinaryColumnar) {
    enqueueWrite(
      formatArtifactLabel(binaryMetaPath),
      async () => {
        const rowPayloads = new Array(postings.tokenVocab.length);
        for (let i = 0; i < postings.tokenVocab.length; i += 1) {
          rowPayloads[i] = encodePostingPairs(postings.tokenPostingsList[i]);
        }
        const frames = encodeBinaryRowFrames(rowPayloads);
        const dataTemp = createTempPath(binaryDataPath);
        const offsetsTemp = createTempPath(binaryOffsetsPath);
        const lengthsTemp = createTempPath(binaryLengthsPath);
        await fs.writeFile(dataTemp, frames.dataBuffer);
        await fs.writeFile(offsetsTemp, frames.offsetsBuffer);
        await fs.writeFile(lengthsTemp, frames.lengthsBuffer);
        await replaceFile(dataTemp, binaryDataPath);
        await replaceFile(offsetsTemp, binaryOffsetsPath);
        await replaceFile(lengthsTemp, binaryLengthsPath);
        await writeJsonObjectFile(binaryMetaPath, {
          fields: {
            format: 'binary-columnar-v1',
            rowEncoding: 'doc-delta-tf-varint',
            count: frames.count,
            avgDocLen: postings.avgDocLen,
            totalDocs: state.docLengths.length,
            data: path.basename(binaryDataPath),
            offsets: path.basename(binaryOffsetsPath),
            lengths: path.basename(binaryLengthsPath)
          },
          arrays: {
            vocab: postings.tokenVocab,
            ...(vocabIds ? { vocabIds } : {}),
            docLengths: state.docLengths
          },
          atomic: true
        });
      }
    );
    addPieceFile({
      type: 'postings',
      name: 'token_postings_binary_columnar',
      format: 'binary-columnar',
      count: postings.tokenVocab.length
    }, binaryDataPath);
    addPieceFile({
      type: 'postings',
      name: 'token_postings_binary_columnar_offsets',
      format: 'binary'
    }, binaryOffsetsPath);
    addPieceFile({
      type: 'postings',
      name: 'token_postings_binary_columnar_lengths',
      format: 'varint'
    }, binaryLengthsPath);
    addPieceFile({
      type: 'postings',
      name: 'token_postings_binary_columnar_meta',
      format: 'json'
    }, binaryMetaPath);
  } else {
    enqueueWrite(
      formatArtifactLabel(binaryMetaPath),
      async () => {
        await fs.rm(binaryDataPath, { force: true });
        await fs.rm(binaryOffsetsPath, { force: true });
        await fs.rm(binaryLengthsPath, { force: true });
        await fs.rm(binaryMetaPath, { force: true });
      }
    );
  }
}
