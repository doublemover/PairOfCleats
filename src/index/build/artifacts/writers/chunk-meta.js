import fs from 'node:fs/promises';
import path from 'node:path';
import { log } from '../../../../shared/progress.js';
import { MAX_JSON_BYTES } from '../../../../shared/artifact-io.js';
import {
  writeJsonArrayFile,
  writeJsonLinesFile,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';

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
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
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
          `using ${chunkMetaMode} to stay under ${formatBytes(maxJsonBytes)}.`
        );
      }
    }
  }
  return {
    chunkMetaCount,
    chunkMetaFormat,
    chunkMetaUseJsonl,
    chunkMetaUseShards,
    chunkMetaShardSize: resolvedShardSize
  };
};

export const enqueueChunkMetaArtifacts = async ({
  state,
  outDir,
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
    chunkMetaCount
  } = chunkMetaPlan;
  const removeArtifact = async (targetPath) => {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
    } catch {}
  };
  if (chunkMetaUseJsonl) {
    await removeArtifact(path.join(outDir, 'chunk_meta.json'));
    await removeArtifact(path.join(outDir, 'chunk_meta.json.gz'));
    if (chunkMetaUseShards) {
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

  const writeJsonlOutput = async () => {
    const useShards = chunkMetaShardSize > 0 && chunkMetaCount > chunkMetaShardSize;
    chunkMetaPlan.chunkMetaUseJsonl = true;
    chunkMetaPlan.chunkMetaUseShards = useShards;
    if (useShards) {
      const partsDir = path.join(outDir, 'chunk_meta.parts');
      await fs.rm(partsDir, { recursive: true, force: true });
      await fs.mkdir(partsDir, { recursive: true });
      const parts = [];
      let partIndex = 0;
      for (let i = 0; i < state.chunks.length; i += chunkMetaShardSize) {
        const end = Math.min(i + chunkMetaShardSize, state.chunks.length);
        const partCount = end - i;
        const partName = `chunk_meta.part-${String(partIndex).padStart(5, '0')}.jsonl`;
        const partPath = path.join(partsDir, partName);
        parts.push(path.posix.join('chunk_meta.parts', partName));
        await writeJsonLinesFile(partPath, chunkMetaIterator(i, end), { atomic: true });
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta',
          format: 'jsonl',
          count: partCount
        }, partPath);
        partIndex += 1;
      }
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      await writeJsonObjectFile(metaPath, {
        fields: {
          format: 'jsonl',
          shardSize: chunkMetaShardSize,
          totalChunks: chunkMetaCount,
          parts
        },
        atomic: true
      });
      addPieceFile({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, metaPath);
      return;
    }
    const jsonlPath = path.join(outDir, 'chunk_meta.jsonl');
    await writeJsonLinesFile(jsonlPath, chunkMetaIterator(), { atomic: true });
    addPieceFile({
      type: 'chunks',
      name: 'chunk_meta',
      format: 'jsonl',
      count: chunkMetaCount
    }, jsonlPath);
  };

  if (chunkMetaUseJsonl) {
    if (chunkMetaUseShards) {
      const partsDir = path.join(outDir, 'chunk_meta.parts');
      await fs.rm(partsDir, { recursive: true, force: true });
      await fs.mkdir(partsDir, { recursive: true });
      const parts = [];
      let partIndex = 0;
      for (let i = 0; i < state.chunks.length; i += chunkMetaShardSize) {
        const end = Math.min(i + chunkMetaShardSize, state.chunks.length);
        const partCount = end - i;
        const partName = `chunk_meta.part-${String(partIndex).padStart(5, '0')}.jsonl`;
        const partPath = path.join(partsDir, partName);
        parts.push(path.posix.join('chunk_meta.parts', partName));
        enqueueWrite(
          formatArtifactLabel(partPath),
          () => writeJsonLinesFile(
            partPath,
            chunkMetaIterator(i, end),
            { atomic: true }
          )
        );
        addPieceFile({
          type: 'chunks',
          name: 'chunk_meta',
          format: 'jsonl',
          count: partCount
        }, partPath);
        partIndex += 1;
      }
      const metaPath = path.join(outDir, 'chunk_meta.meta.json');
      enqueueWrite(
        formatArtifactLabel(metaPath),
        () => writeJsonObjectFile(metaPath, {
          fields: {
            format: 'jsonl',
            shardSize: chunkMetaShardSize,
            totalChunks: chunkMetaCount,
            parts
          },
          atomic: true
        })
      );
      addPieceFile({ type: 'chunks', name: 'chunk_meta_meta', format: 'json' }, metaPath);
    } else {
      const jsonlPath = path.join(outDir, 'chunk_meta.jsonl');
      enqueueWrite(
        formatArtifactLabel(jsonlPath),
        () => writeJsonLinesFile(jsonlPath, chunkMetaIterator(), { atomic: true })
      );
      addPieceFile({
        type: 'chunks',
        name: 'chunk_meta',
        format: 'jsonl',
        count: chunkMetaCount
      }, jsonlPath);
    }
  } else {
    const jsonPath = path.join(outDir, 'chunk_meta.json');
    enqueueWrite(
      formatArtifactLabel(jsonPath),
      async () => {
        await writeJsonArrayFile(jsonPath, chunkMetaIterator(), { atomic: true });
        const stat = await fs.stat(jsonPath);
        if (stat.size <= maxJsonBytes) {
          addPieceFile({
            type: 'chunks',
            name: 'chunk_meta',
            format: 'json',
            count: chunkMetaCount
          }, jsonPath);
          return;
        }
        await fs.rm(jsonPath, { force: true });
        await writeJsonlOutput();
      }
    );
  }
};
