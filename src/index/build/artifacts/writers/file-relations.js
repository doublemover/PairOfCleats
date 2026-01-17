import fs from 'node:fs/promises';
import path from 'node:path';
import {
  writeJsonArrayFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';

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
  const relationsPath = path.join(outDir, 'file_relations.json');
  const relationsJsonlPath = path.join(outDir, 'file_relations.jsonl');
  const relationsMetaPath = path.join(outDir, 'file_relations.meta.json');
  const relationsPartsDir = path.join(outDir, 'file_relations.parts');

  if (!useJsonl) {
    enqueueWrite(
      formatArtifactLabel(relationsPath),
      async () => {
        await fs.rm(relationsJsonlPath, { force: true });
        await fs.rm(relationsMetaPath, { force: true });
        await fs.rm(relationsPartsDir, { recursive: true, force: true });
        await writeJsonArrayFile(
          relationsPath,
          fileRelationsIterator(),
          { atomic: true }
        );
      }
    );
    addPieceFile({
      type: 'relations',
      name: 'file_relations',
      format: 'json',
      count: totalEntries
    }, relationsPath);
    return;
  }

  if (log) {
    log(`file_relations ~${Math.round(totalJsonlBytes / 1024)}KB; writing JSONL shards.`);
  }
  enqueueWrite(
    formatArtifactLabel(relationsMetaPath),
    async () => {
      await fs.rm(relationsPath, { force: true });
      await fs.rm(relationsJsonlPath, { force: true });
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: 'file_relations.parts',
        partPrefix: 'file_relations.part-',
        items: fileRelationsIterator(),
        maxBytes: resolvedMaxBytes,
        atomic: true
      });
      const shardSize = result.counts.length
        ? Math.max(...result.counts)
        : null;
      await writeJsonObjectFile(relationsMetaPath, {
        fields: {
          format: 'jsonl',
          shardSize,
          totalEntries: result.total,
          parts: result.parts
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
          count: result.counts[i] || 0
        }, absPath);
      }
      addPieceFile({ type: 'relations', name: 'file_relations_meta', format: 'json' }, relationsMetaPath);
    }
  );
};
