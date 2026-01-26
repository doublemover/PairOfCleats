import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonArrayFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../../contracts/versioning.js';

export const createFileRelationsIterator = (relations) => function* fileRelationsIterator() {
  if (!relations || typeof relations.entries !== 'function') return;
  for (const [file, data] of relations.entries()) {
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
  log = null,
  compression = null,
  gzipOptions = null,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel
}) => {
  if (!state.fileRelations || !state.fileRelations.size) return;
  const fileRelationsIterator = createFileRelationsIterator(state.fileRelations);
  const resolvedMaxBytes = Number.isFinite(Number(maxJsonBytes)) ? Math.floor(Number(maxJsonBytes)) : 0;
  let totalBytes = 2;
  let totalJsonlBytes = 0;
  let totalEntries = 0;
  for (const entry of fileRelationsIterator()) {
    const line = JSON.stringify(entry);
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (resolvedMaxBytes && (lineBytes + 1) > resolvedMaxBytes) {
      throw new Error(`file_relations entry exceeds max JSON size (${lineBytes} bytes).`);
    }
    totalBytes += lineBytes + (totalEntries > 0 ? 1 : 0);
    totalJsonlBytes += lineBytes + 1;
    totalEntries += 1;
  }
  if (!totalEntries) return;

  const useJsonl = resolvedMaxBytes && totalBytes > resolvedMaxBytes;
  const resolveJsonExtension = (value) => {
    if (value === 'gzip') return 'json.gz';
    if (value === 'zstd') return 'json.zst';
    return 'json';
  };
  const jsonExtension = resolveJsonExtension(compression);
  const relationsPath = path.join(outDir, `file_relations.${jsonExtension}`);
  const resolveJsonlExtension = (value) => {
    if (value === 'gzip') return 'jsonl.gz';
    if (value === 'zstd') return 'jsonl.zst';
    return 'jsonl';
  };
  const jsonlExtension = resolveJsonlExtension(compression);
  const relationsJsonlPath = path.join(outDir, `file_relations.${jsonlExtension}`);
  const relationsMetaPath = path.join(outDir, 'file_relations.meta.json');
  const relationsPartsDir = path.join(outDir, 'file_relations.parts');
  const removeJsonlVariants = async () => {
    await fs.rm(path.join(outDir, 'file_relations.jsonl'), { force: true });
    await fs.rm(path.join(outDir, 'file_relations.jsonl.gz'), { force: true });
    await fs.rm(path.join(outDir, 'file_relations.jsonl.zst'), { force: true });
  };
  const removeJsonVariants = async () => {
    await fs.rm(path.join(outDir, 'file_relations.json'), { force: true });
    await fs.rm(path.join(outDir, 'file_relations.json.gz'), { force: true });
    await fs.rm(path.join(outDir, 'file_relations.json.zst'), { force: true });
  };

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
    return;
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
      const parts = result.parts.map((part, index) => ({
        path: part,
        records: result.counts[index] || 0,
        bytes: result.bytes[index] || 0
      }));
      await writeJsonObjectFile(relationsMetaPath, {
        fields: {
          schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
          artifact: 'file_relations',
          format: 'jsonl-sharded',
          generatedAt: new Date().toISOString(),
          compression: compression || 'none',
          totalRecords: result.total,
          totalBytes: result.totalBytes,
          maxPartRecords: result.maxPartRecords,
          maxPartBytes: result.maxPartBytes,
          targetMaxBytes: result.targetMaxBytes,
          parts
        },
        atomic: true
      });
      for (let i = 0; i < result.parts.length; i += 1) {
        const relPath = result.parts[i];
        const absPath = path.join(outDir, relPath.split('/').join(path.sep));
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
};
