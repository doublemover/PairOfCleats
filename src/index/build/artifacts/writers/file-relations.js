import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonArrayFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { createOrderingHasher, stableOrderMapEntries } from '../../../../shared/order.js';
import { applyByteBudget } from '../../byte-budget.js';
import {
  buildJsonlVariantPaths,
  buildJsonVariantPaths,
  buildShardedPartEntries,
  removeArtifacts,
  resolveJsonExtension,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from './_common.js';

export const createFileRelationsIterator = (relations) => function* fileRelationsIterator() {
  if (!relations || typeof relations.entries !== 'function') return;
  const ordered = stableOrderMapEntries(relations, ['key']);
  for (const { key: file, value: data } of ordered) {
    if (!file || !data) continue;
    yield {
      file,
      relations: data
    };
  }
};

export const enqueueFileRelationsArtifacts = ({
  state,
  outDir,
  maxJsonBytes = null,
  byteBudget = null,
  log = null,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  stageCheckpoints
}) => {
  if (!state.fileRelations || !state.fileRelations.size) return;
  const fileRelationsIterator = createFileRelationsIterator(state.fileRelations);
  const resolvedMaxBytes = Number.isFinite(Number(maxJsonBytes)) ? Math.floor(Number(maxJsonBytes)) : 0;
  let totalBytes = 2;
  let totalJsonlBytes = 0;
  let totalEntries = 0;
  const orderingHasher = createOrderingHasher();
  for (const entry of fileRelationsIterator()) {
    const line = JSON.stringify(entry);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    orderingHasher.update(line);
    if (resolvedMaxBytes && (lineBytes + 1) > resolvedMaxBytes) {
      throw new Error(`file_relations entry exceeds max JSON size (${lineBytes} bytes).`);
    }
    totalBytes += lineBytes + (totalEntries > 0 ? 1 : 0);
    totalJsonlBytes += lineBytes + 1;
    totalEntries += 1;
  }
  if (!totalEntries) return { orderingHash: null, orderingCount: 0 };
  const orderingResult = orderingHasher.digest();
  const orderingHash = orderingResult?.hash || null;
  const orderingCount = orderingResult?.count || 0;

  const useJsonl = resolvedMaxBytes && totalBytes > resolvedMaxBytes;
  const budgetBytes = useJsonl ? totalJsonlBytes : totalBytes;
  applyByteBudget({
    budget: byteBudget,
    totalBytes: budgetBytes,
    label: 'file_relations',
    stageCheckpoints,
    logger: log
  });
  const jsonExtension = resolveJsonExtension(compression);
  const relationsPath = path.join(outDir, `file_relations.${jsonExtension}`);
  const jsonlExtension = resolveJsonlExtension(compression);
  const relationsJsonlPath = path.join(outDir, `file_relations.${jsonlExtension}`);
  const relationsMetaPath = path.join(outDir, 'file_relations.meta.json');
  const relationsPartsDir = path.join(outDir, 'file_relations.parts');
  const removeJsonlVariants = async () => removeArtifacts(
    buildJsonlVariantPaths({ outDir, baseName: 'file_relations' })
  );
  const removeJsonVariants = async () => removeArtifacts(
    buildJsonVariantPaths({ outDir, baseName: 'file_relations' })
  );

  if (!useJsonl) {
    enqueueWrite(
      formatArtifactLabel(relationsPath),
      async () => {
        await removeJsonlVariants();
        await removeJsonVariants();
        await fs.rm(relationsMetaPath, { force: true });
        await fs.rm(relationsPartsDir, { recursive: true, force: true });
        await writeJsonArrayFile(
          relationsPath,
          fileRelationsIterator(),
          { atomic: true, compression, gzipOptions }
        );
      }
    );
    addPieceFile({
      type: 'relations',
      name: 'file_relations',
      format: 'json',
      count: totalEntries,
      compression: compression || null
    }, relationsPath);
    return { orderingHash, orderingCount };
  }

  if (log) {
    log(`file_relations ~${Math.round(totalJsonlBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(relationsMetaPath),
    async () => {
      await removeJsonVariants();
      await removeJsonlVariants();
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: 'file_relations.parts',
        partPrefix: 'file_relations.part-',
        items: fileRelationsIterator(),
        maxBytes: resolvedMaxBytes,
        atomic: true,
        compression,
        gzipOptions
      });
      const parts = buildShardedPartEntries(result);
      await writeShardedJsonlMeta({
        metaPath: relationsMetaPath,
        artifact: 'file_relations',
        compression,
        result,
        parts
      });
      for (let i = 0; i < result.parts.length; i += 1) {
        const relPath = result.parts[i];
        const absPath = path.join(outDir, fromPosix(relPath));
        addPieceFile({
          type: 'relations',
          name: 'file_relations',
          format: 'jsonl',
          count: result.counts[i] || 0,
          compression: compression || null
        }, absPath);
      }
      addPieceFile({ type: 'relations', name: 'file_relations_meta', format: 'json' }, relationsMetaPath);
    }
  );
  return { orderingHash, orderingCount };
};
