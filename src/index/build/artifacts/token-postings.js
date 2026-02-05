import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { TOKEN_ID_META } from '../../../shared/token-id.js';
import { createTempPath, replaceFile } from '../../../shared/json-stream/atomic.js';
import { DEFAULT_PACKED_BLOCK_SIZE, encodePackedOffsets, packTfPostings } from '../../../shared/packed-postings.js';
import { estimatePostingsBytes, formatBytes } from './helpers.js';

const normalizeTokenPostingsFormat = (value, artifactMode) => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (raw === 'packed' || raw === 'json' || raw === 'sharded' || raw === 'auto') return raw;
  if (artifactMode === 'json') return 'json';
  if (artifactMode === 'sharded') return 'sharded';
  return 'auto';
};

export function resolveTokenPostingsPlan({
  artifactMode,
  tokenPostingsFormatConfig,
  tokenPostingsShardSize,
  tokenPostingsShardThreshold,
  postings,
  maxJsonBytes,
  maxJsonBytesSoft,
  shardTargetBytes,
  log
}) {
  const tokenPostingsFormat = normalizeTokenPostingsFormat(tokenPostingsFormatConfig, artifactMode);
  let resolvedShardSize = tokenPostingsShardSize;
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
      const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / tokenPostingsEstimate.avgBytes));
      resolvedShardSize = Math.min(resolvedShardSize, targetShardSize);
      log(
        `Token postings estimate ~${formatBytes(tokenPostingsEstimate.estimatedBytes)}; ` +
        `using sharded output to stay under ${formatBytes(maxJsonBytes)}.`
      );
    } else if (tokenPostingsUseShards) {
      const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / tokenPostingsEstimate.avgBytes));
      resolvedShardSize = Math.min(resolvedShardSize, targetShardSize);
    }
  }
  return {
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsShardSize: resolvedShardSize,
    tokenPostingsEstimate
  };
}

export async function enqueueTokenPostingsArtifacts({
  outDir,
  postings,
  state,
  tokenPostingsFormat,
  tokenPostingsUseShards,
  tokenPostingsShardSize,
  tokenPostingsCompression,
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
            offsets: path.posix.basename(offsetsPath),
            ...(tokenIdMeta ? { tokenId: tokenIdMeta } : {})
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
  };

  if (tokenPostingsFormat === 'packed') {
    await writePackedTokenPostings();
    return;
  }
  if (tokenPostingsUseShards) {
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
          await writeJsonObjectFile(partPath, {
            arrays: {
              vocab: postings.tokenVocab.slice(part.start, part.end),
              ...(vocabIds ? { vocabIds: vocabIds.slice(part.start, part.end) } : {}),
              postings: postings.tokenPostingsList.slice(part.start, part.end)
            },
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
      piece: { type: 'postings', name: 'token_postings', count: postings.tokenVocab.length }
    });
  }
}
