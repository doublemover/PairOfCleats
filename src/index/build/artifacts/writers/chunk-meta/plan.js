import { log } from '../../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../../shared/artifact-io.js';
import { formatBytes } from '../../../../../shared/disk-space.js';
import { resolveChunkMetaMaxBytes } from './shared.js';

/**
 * Decide chunk_meta artifact mode/sharding based on estimated row size and limits.
 * @param {{chunks:Array<object>,chunkMetaIterator:function,artifactMode:string,chunkMetaFormatConfig?:string|null,chunkMetaStreaming?:boolean,chunkMetaBinaryColumnar?:boolean,chunkMetaJsonlThreshold:number,chunkMetaShardSize:number,chunkMetaJsonlEstimateThresholdBytes?:number,maxJsonBytes?:number}} input
 * @returns {object}
 */
export const resolveChunkMetaPlan = ({
  chunks,
  chunkMetaIterator,
  artifactMode,
  chunkMetaFormatConfig,
  chunkMetaStreaming = false,
  chunkMetaBinaryColumnar = false,
  chunkMetaJsonlThreshold,
  chunkMetaShardSize,
  chunkMetaJsonlEstimateThresholdBytes = 1 * 1024 * 1024,
  maxJsonBytes = MAX_JSON_BYTES
}) => {
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(maxJsonBytes);
  const resolvedJsonlEstimateThresholdBytes = Number.isFinite(Number(chunkMetaJsonlEstimateThresholdBytes))
    ? Math.max(1, Math.floor(Number(chunkMetaJsonlEstimateThresholdBytes)))
    : (1 * 1024 * 1024);
  const maxJsonBytesSoft = resolvedMaxJsonBytes * 0.9;
  const shardTargetBytes = resolvedMaxJsonBytes * 0.75;
  const chunkMetaCount = chunks.length;
  const chunkMetaFormat = chunkMetaFormatConfig
    || (artifactMode === 'jsonl' ? 'jsonl' : (artifactMode === 'json' ? 'json' : 'auto'));
  let chunkMetaUseColumnar = chunkMetaFormat === 'columnar';
  let chunkMetaUseJsonl = !chunkMetaUseColumnar && (
    chunkMetaFormat === 'jsonl'
      || (chunkMetaFormat === 'auto' && chunkMetaCount >= chunkMetaJsonlThreshold)
  );
  let resolvedShardSize = chunkMetaShardSize;
  let estimatedJsonlBytes = 0;
  let chunkMetaUseShards = chunkMetaUseJsonl
    && resolvedShardSize > 0
    && chunkMetaCount > resolvedShardSize;
  if (chunkMetaCount > 0) {
    const sampleSize = Math.min(chunkMetaCount, 200);
    let sampledBytes = 0;
    let sampled = 0;
    for (const entry of chunkMetaIterator(0, sampleSize, false)) {
      sampledBytes += Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
      sampled += 1;
    }
    if (sampled) {
      const avgBytes = sampledBytes / sampled;
      const estimatedBytes = avgBytes * chunkMetaCount;
      estimatedJsonlBytes = estimatedBytes;
      const forceJsonlByEstimate = chunkMetaFormat === 'auto'
        && estimatedBytes >= resolvedJsonlEstimateThresholdBytes;
      if (estimatedBytes > maxJsonBytesSoft || forceJsonlByEstimate) {
        if (chunkMetaUseColumnar) {
          chunkMetaUseColumnar = false;
        }
        chunkMetaUseJsonl = true;
        if (estimatedBytes > maxJsonBytesSoft) {
          const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / avgBytes));
          if (resolvedShardSize > 0) {
            resolvedShardSize = Math.min(resolvedShardSize, targetShardSize);
          } else {
            resolvedShardSize = targetShardSize;
          }
        }
        chunkMetaUseShards = chunkMetaCount > resolvedShardSize;
        const chunkMetaMode = chunkMetaUseShards ? 'jsonl-sharded' : 'jsonl';
        const reason = estimatedBytes > maxJsonBytesSoft
          ? `to stay under ${formatBytes(resolvedMaxJsonBytes)}`
          : `to avoid large-array JSON serialization overhead (threshold ${formatBytes(resolvedJsonlEstimateThresholdBytes)})`;
        log(
          `Chunk metadata estimate ~${formatBytes(estimatedBytes)}; ` +
          `using ${chunkMetaMode} ${reason}.`
        );
      }
    }
  }
  return {
    chunkMetaCount,
    chunkMetaFormat,
    chunkMetaStreaming: chunkMetaStreaming === true,
    chunkMetaBinaryColumnar: chunkMetaBinaryColumnar === true,
    chunkMetaEstimatedJsonlBytes: estimatedJsonlBytes,
    chunkMetaUseJsonl,
    chunkMetaUseColumnar,
    chunkMetaUseShards,
    chunkMetaShardSize: resolvedShardSize,
    maxJsonBytes: resolvedMaxJsonBytes
  };
};
