import fs from 'node:fs/promises';
import path from 'node:path';
import { writeJsonObjectFile } from '../../../shared/json-stream.js';
import { estimatePostingsBytes, formatBytes } from './helpers.js';

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
  const tokenPostingsFormat = tokenPostingsFormatConfig
    || (artifactMode === 'sharded' ? 'sharded' : (artifactMode === 'json' ? 'json' : 'auto'));
  let resolvedShardSize = tokenPostingsShardSize;
  let tokenPostingsUseShards = tokenPostingsFormat === 'sharded'
    || (tokenPostingsFormat === 'auto'
      && postings.tokenVocab.length >= tokenPostingsShardThreshold);
  const tokenPostingsEstimate = estimatePostingsBytes(
    postings.tokenVocab,
    postings.tokenPostingsList
  );
  if (tokenPostingsEstimate) {
    if (tokenPostingsEstimate.estimatedBytes > maxJsonBytesSoft) {
      tokenPostingsUseShards = true;
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
  tokenPostingsUseShards,
  tokenPostingsShardSize,
  tokenPostingsCompression,
  enqueueJsonObject,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) {
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
            compression: tokenPostingsCompression || null
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
        totalDocs: state.docLengths.length
      },
      arrays: {
        vocab: postings.tokenVocab,
        postings: postings.tokenPostingsList,
        docLengths: state.docLengths
      }
    }, {
      piece: { type: 'postings', name: 'token_postings', count: postings.tokenVocab.length }
    });
  }
}
