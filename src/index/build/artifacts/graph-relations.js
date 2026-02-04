import path from 'node:path';
import { writeJsonLinesSharded, writeJsonObjectFile } from '../../../shared/json-stream.js';
import { SHARDED_JSONL_META_SCHEMA_VERSION } from '../../../contracts/versioning.js';
import { fromPosix } from '../../../shared/files.js';
import {
  createGraphRelationsIterator,
  materializeGraphRelationsPayload,
  measureGraphRelations
} from './helpers.js';

export async function enqueueGraphRelationsArtifacts({
  graphRelations,
  outDir,
  maxJsonBytes,
  log,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  removeArtifact
}) {
  if (!graphRelations || typeof graphRelations !== 'object') return;
  const graphMeasurement = measureGraphRelations(graphRelations, { maxJsonBytes });
  if (!graphMeasurement) return;
  const graphPath = path.join(outDir, 'graph_relations.json');
  const graphJsonlPath = path.join(outDir, 'graph_relations.jsonl');
  const graphMetaPath = path.join(outDir, 'graph_relations.meta.json');
  const graphPartsDir = path.join(outDir, 'graph_relations.parts');
  const offsetsConfig = { suffix: 'offsets.bin' };
  const useGraphJsonl = maxJsonBytes && graphMeasurement.totalJsonBytes > maxJsonBytes;
  if (!useGraphJsonl) {
    enqueueWrite(
      formatArtifactLabel(graphPath),
      async () => {
        await removeArtifact(graphJsonlPath);
        await removeArtifact(graphMetaPath);
        await removeArtifact(graphPartsDir);
        const payload = materializeGraphRelationsPayload(graphRelations);
        await writeJsonObjectFile(graphPath, { fields: payload, atomic: true });
      }
    );
    addPieceFile({ type: 'relations', name: 'graph_relations', format: 'json' }, graphPath);
  } else {
    log(
      `graph_relations ~${Math.round(graphMeasurement.totalJsonlBytes / 1024)}KB; ` +
      'writing JSONL shards.'
    );
    enqueueWrite(
      formatArtifactLabel(graphMetaPath),
      async () => {
        await removeArtifact(graphPath);
        await removeArtifact(graphJsonlPath);
        const result = await writeJsonLinesSharded({
          dir: outDir,
          partsDirName: 'graph_relations.parts',
          partPrefix: 'graph_relations.part-',
          items: createGraphRelationsIterator(graphRelations)(),
          maxBytes: maxJsonBytes,
          atomic: true,
          offsets: offsetsConfig
        });
        const parts = result.parts.map((part, index) => ({
          path: part,
          records: result.counts[index] || 0,
          bytes: result.bytes[index] || 0
        }));
        const offsetsMeta = result.offsets?.length
          ? {
            format: 'u64-le',
            suffix: offsetsConfig.suffix,
            parts: result.offsets
          }
          : null;
        await writeJsonObjectFile(graphMetaPath, {
          fields: {
            schemaVersion: SHARDED_JSONL_META_SCHEMA_VERSION,
            artifact: 'graph_relations',
            format: 'jsonl-sharded',
            generatedAt: graphMeasurement.generatedAt,
            compression: 'none',
            totalRecords: result.total,
            totalBytes: result.totalBytes,
            maxPartRecords: result.maxPartRecords,
            maxPartBytes: result.maxPartBytes,
            targetMaxBytes: result.targetMaxBytes,
            parts,
            extensions: {
              graphs: graphMeasurement.graphs,
              caps: graphRelations.caps ?? null,
              version: graphMeasurement.version,
              ...(offsetsMeta ? { offsets: offsetsMeta } : {})
            }
          },
          atomic: true
        });
        for (let i = 0; i < result.parts.length; i += 1) {
          const relPath = result.parts[i];
          const absPath = path.join(outDir, fromPosix(relPath));
          addPieceFile({
            type: 'relations',
            name: 'graph_relations',
            format: 'jsonl',
            count: result.counts[i] || 0
          }, absPath);
        }
        if (Array.isArray(result.offsets)) {
          for (let i = 0; i < result.offsets.length; i += 1) {
            const relPath = result.offsets[i];
            if (!relPath) continue;
            const absPath = path.join(outDir, fromPosix(relPath));
            addPieceFile({
              type: 'relations',
              name: 'graph_relations_offsets',
              format: 'bin',
              count: result.counts[i] || 0
            }, absPath);
          }
        }
        addPieceFile({ type: 'relations', name: 'graph_relations_meta', format: 'json' }, graphMetaPath);
      }
    );
  }
}
