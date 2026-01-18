import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import { ensureDiskSpace } from '../../../../shared/disk-space.js';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';

const MIN_CHUNK_META_BYTES = 4096;

const resolveChunkMetaMaxBytes = (maxJsonBytes) => {
  const parsed = Number(maxJsonBytes);
  if (!Number.isFinite(parsed) || parsed <= 0) return maxJsonBytes;
  return Math.max(Math.floor(parsed), MIN_CHUNK_META_BYTES);
};

const formatBytes = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  if (value < 1024) return `${Math.round(value)}B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)}MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)}GB`;
};

export const createChunkMetaIterator = ({
  chunks,
  fileIdByPath,
  resolvedTokenMode,
  tokenSampleSize
}) => function* chunkMetaIterator(start = 0, end = chunks.length) {
  for (let i = start; i < end; i += 1) {
    const c = chunks[i];
    const entry = {
      id: c.id,
      fileId: fileIdByPath.get(c.file) ?? null,
      start: c.start,
      end: c.end,
      startLine: c.startLine,
      endLine: c.endLine,
      kind: c.kind,
      name: c.name,
      weight: c.weight,
      headline: c.headline,
      preContext: c.preContext,
      postContext: c.postContext,
      segment: c.segment || null,
      codeRelations: c.codeRelations,
      docmeta: c.docmeta,
      metaV2: c.metaV2,
      stats: c.stats,
      complexity: c.complexity,
      lint: c.lint,
      chunk_authors: c.chunk_authors
    };
    if (resolvedTokenMode !== 'none') {
      const tokens = Array.isArray(c.tokens) ? c.tokens : [];
      const ngrams = Array.isArray(c.ngrams) ? c.ngrams : null;
      const tokenOut = resolvedTokenMode === 'sample'
        ? tokens.slice(0, tokenSampleSize)
        : tokens;
      const ngramOut = resolvedTokenMode === 'sample' && Array.isArray(ngrams)
        ? ngrams.slice(0, tokenSampleSize)
        : ngrams;
      entry.tokens = tokenOut;
      entry.ngrams = ngramOut;
    }
    yield entry;
  }
};

export const resolveChunkMetaPlan = ({
  chunks,
  chunkMetaIterator,
  artifactMode,
  chunkMetaFormatConfig,
  chunkMetaJsonlThreshold,
  chunkMetaShardSize,
  maxJsonBytes = MAX_JSON_BYTES
}) => {
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(maxJsonBytes);
  const maxJsonBytesSoft = resolvedMaxJsonBytes * 0.9;
  const shardTargetBytes = resolvedMaxJsonBytes * 0.75;
  const chunkMetaCount = chunks.length;
  const chunkMetaFormat = chunkMetaFormatConfig
    || (artifactMode === 'jsonl' ? 'jsonl' : (artifactMode === 'json' ? 'json' : 'auto'));
  let chunkMetaUseJsonl = chunkMetaFormat === 'jsonl'
    || (chunkMetaFormat === 'auto' && chunkMetaCount >= chunkMetaJsonlThreshold);
  let resolvedShardSize = chunkMetaShardSize;
  let chunkMetaUseShards = chunkMetaUseJsonl
    && resolvedShardSize > 0
    && chunkMetaCount > resolvedShardSize;
  if (chunkMetaCount > 0) {
    const sampleSize = Math.min(chunkMetaCount, 200);
    let sampledBytes = 0;
    let sampled = 0;
    for (const entry of chunkMetaIterator(0, sampleSize)) {
      sampledBytes += Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
      sampled += 1;
    }
    if (sampled) {
      const avgBytes = sampledBytes / sampled;
      const estimatedBytes = avgBytes * chunkMetaCount;
      if (estimatedBytes > maxJsonBytesSoft) {
        chunkMetaUseJsonl = true;
        const targetShardSize = Math.max(1, Math.floor(shardTargetBytes / avgBytes));
        if (resolvedShardSize > 0) {
          resolvedShardSize = Math.min(resolvedShardSize, targetShardSize);
        } else {
          resolvedShardSize = targetShardSize;
        }
        chunkMetaUseShards = chunkMetaCount > resolvedShardSize;
        const chunkMetaMode = chunkMetaUseShards ? 'jsonl-sharded' : 'jsonl';
        log(
          `Chunk metadata estimate ~${formatBytes(estimatedBytes)}; ` +
          `using ${chunkMetaMode} to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
        );
      }
    }
  }
  return {
    chunkMetaCount,
    chunkMetaFormat,
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaShardSize: resolvedShardSize,
    maxJsonBytes: resolvedMaxJsonBytes
  };
};

export const enqueueChunkMetaArtifacts = async ({
  outDir,
  mode,
  chunkMetaIterator,
  chunkMetaPlan,
  maxJsonBytes = MAX_JSON_BYTES,
  enqueueJsonArray,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  const {
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaShardSize,
    chunkMetaCount,
    maxJsonBytes: plannedMaxJsonBytes
  } = chunkMetaPlan;
  const resolvedMaxJsonBytes = resolveChunkMetaMaxBytes(plannedMaxJsonBytes ?? maxJsonBytes);
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  const measureChunkMeta = () => {
    let totalJsonBytes = 2;
    let totalJsonlBytes = 0;
    let total = 0;
    for (const entry of chunkMetaIterator()) {
      const line = JSON.stringify(entry);
      const lineBytes = Buffer.byteLength(line, 'utf8');
      if (resolvedMaxJsonBytes && (lineBytes + 1) > resolvedMaxJsonBytes) {
        throw new Error(`chunk_meta entry exceeds max JSON size (${lineBytes} bytes).`);
      }
      totalJsonBytes += lineBytes + (total > 0 ? 1 : 0);
      totalJsonlBytes += lineBytes + 1;
      total += 1;
    }
    return { totalJsonBytes, totalJsonlBytes, total };
  };

  const measured = chunkMetaCount
    ? measureChunkMeta()
    : { totalJsonBytes: 2, totalJsonlBytes: 0, total: 0 };
  let resolvedUseJsonl = chunkMetaUseJsonl;
  let resolvedUseShards = chunkMetaUseShards;
  if (!resolvedUseJsonl && resolvedMaxJsonBytes && measured.totalJsonBytes > resolvedMaxJsonBytes) {
    resolvedUseJsonl = true;
    resolvedUseShards = true;
    log(
      `Chunk metadata measured ~${formatBytes(measured.totalJsonBytes)}; ` +
      `using jsonl-sharded to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
    );
  } else if (resolvedUseJsonl && resolvedMaxJsonBytes && measured.totalJsonlBytes > resolvedMaxJsonBytes) {
    resolvedUseShards = true;
    if (!chunkMetaUseShards) {
      log(
        `Chunk metadata measured ~${formatBytes(measured.totalJsonlBytes)}; ` +
        `using jsonl-sharded to stay under ${formatBytes(resolvedMaxJsonBytes)}.`
      );
    }
  }
  chunkMetaPlan.chunkMetaUseJsonl = resolvedUseJsonl;
  chunkMetaPlan.chunkMetaUseShards = resolvedUseShards;
  const requiredBytes = resolvedUseJsonl ? measured.totalJsonlBytes : measured.totalJsonBytes;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes,
    label: mode ? `${mode} chunk_meta` : 'chunk_meta'
  });

  if (resolvedUseJsonl) {
    await removeArtifact(path.join(outDir, 'chunk_meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.zst'));
    if (resolvedUseShards) {
      // When writing sharded JSONL output, ensure any prior unsharded JSONL output is removed.
      await removeArtifact(path.join(outDir, 'chunk_meta.jsonl'));
    } else {
      // When writing unsharded JSONL output, remove any stale shard artifacts.
      // The loader prefers chunk_meta.meta.json / chunk_meta.parts over chunk_meta.jsonl.
      await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
      await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
    }
  } else {
    await removeArtifact(path.join(outDir, 'chunk_meta.jsonl'));
    await removeArtifact(path.join(outDir, 'chunk_meta.meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.parts'));
  }

  if (resolvedUseJsonl) {
    if (resolvedUseShards) {
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      enqueueWrite(
        formatArtifactLabel(metaPath),
        async () => {
          const result = await writeJsonLinesSharded({
            dir: outDir,
            partsDirName: 'chunk_meta.parts',
            partPrefix: 'chunk_meta.part-',
            items: chunkMetaIterator(),
            maxBytes: resolvedMaxJsonBytes,
            maxItems: chunkMetaShardSize,
            atomic: true
          });
          const shardSize = result.counts.length
            ? Math.max(...result.counts)
            : chunkMetaShardSize || null;
          await writeJsonObjectFile(metaPath, {
            fields: {
              format: 'jsonl',
              shardSize,
              totalChunks: chunkMetaCount,
              parts: result.parts
            },
            atomic: true
          });
          for (let i = 0; i < result.parts.length; i += 1) {
            const relPath = result.parts[i];
            const absPath = path.join(outDir, relPath.split('/').join(path.sep));
            addPieceFile({
              type: 'chunks',
              name: 'chunk_meta',
              format: 'jsonl',
              count: result.counts[i] || 0
            }, absPath);
          }
          addPieceFile({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, metaPath);
        }
      );
    } else {
      const jsonlPath = path.join(outDir, 'chunk_meta.jsonl');
      enqueueWrite(
        formatArtifactLabel(jsonlPath),
        () => writeJsonLinesFile(
          jsonlPath,
          chunkMetaIterator(),
          { atomic: true }
        )
      );
      addPieceFile({
        type: 'chunks',
        name: 'chunk_meta',
        format: 'jsonl',
        count: chunkMetaCount
      }, jsonlPath);
    }
  } else {
    enqueueJsonArray('chunk_meta', chunkMetaIterator(), {
      piece: { type: 'chunks', name: 'chunk_meta', count: chunkMetaCount }
    });
  }
};
