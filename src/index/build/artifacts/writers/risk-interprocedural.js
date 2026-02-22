import path from 'node:path';
import {
  writeJsonLinesFile,
  writeJsonLinesSharded,
  writeJsonObjectFile
} from '../../../../shared/json-stream.js';
import { fromPosix } from '../../../../shared/files.js';
import { buildRiskInterproceduralArtifactRef, buildRiskInterproceduralStats } from '../../../risk-interprocedural/engine.js';
import {
  buildJsonlVariantPaths,
  buildShardedPartEntries,
  measureJsonlRows,
  removeArtifacts,
  resolveJsonlExtension,
  writeShardedJsonlMeta
} from './_common.js';

const writeJsonlArtifact = ({
  name,
  rows,
  outDir,
  maxJsonBytes,
  compression,
  gzipOptions,
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  log,
  forceEmpty = false
}) => {
  if (!Array.isArray(rows)) return null;
  if (!rows.length && !forceEmpty) return null;
  const { totalBytes } = measureJsonlRows(rows);
  const resolvedMaxBytes = Number.isFinite(Number(maxJsonBytes)) ? Math.floor(Number(maxJsonBytes)) : 0;
  const useShards = resolvedMaxBytes && totalBytes > resolvedMaxBytes && rows.length > 0;
  const jsonlExtension = resolveJsonlExtension(compression);
  const basePath = path.join(outDir, `${name}.${jsonlExtension}`);
  const metaPath = path.join(outDir, `${name}.meta.json`);

  if (!useShards) {
    enqueueWrite(
      formatArtifactLabel(basePath),
      async () => {
        await removeArtifacts([
          ...buildJsonlVariantPaths({ outDir, baseName: name }),
          metaPath,
          path.join(outDir, `${name}.parts`)
        ]);
        await writeJsonLinesFile(basePath, rows, { atomic: true, compression, gzipOptions });
      }
    );
    addPieceFile({
      type: 'risk',
      name,
      format: 'jsonl',
      count: rows.length,
      compression: compression || null
    }, basePath);
    return buildRiskInterproceduralArtifactRef({
      name,
      sharded: false,
      entrypoint: formatArtifactLabel(basePath),
      totalEntries: rows.length
    });
  }

  if (log) {
    log(`${name} ~${Math.round(totalBytes / 1024)}KB; writing JSONL shards.`);
  }

  enqueueWrite(
    formatArtifactLabel(metaPath),
    async () => {
      await removeArtifacts(buildJsonlVariantPaths({ outDir, baseName: name }));
      const result = await writeJsonLinesSharded({
        dir: outDir,
        partsDirName: `${name}.parts`,
        partPrefix: `${name}.part-`,
        items: rows,
        maxBytes: resolvedMaxBytes,
        atomic: true,
        compression,
        gzipOptions
      });
      const parts = buildShardedPartEntries(result);
      await writeShardedJsonlMeta({
        metaPath,
        artifact: name,
        compression,
        result,
        parts
      });
      for (let i = 0; i < result.parts.length; i += 1) {
        const relPath = result.parts[i];
        const absPath = path.join(outDir, fromPosix(relPath));
        addPieceFile({
          type: 'risk',
          name,
          format: 'jsonl',
          count: result.counts[i] || 0,
          compression: compression || null
        }, absPath);
      }
      addPieceFile({ type: 'risk', name: `${name}_meta`, format: 'json' }, metaPath);
    }
  );

  return buildRiskInterproceduralArtifactRef({
    name,
    sharded: true,
    entrypoint: formatArtifactLabel(metaPath),
    totalEntries: rows.length
  });
};

export const enqueueRiskInterproceduralArtifacts = ({
  state,
  outDir,
  maxJsonBytes = null,
  compression = null,
  gzipOptions = null,
  flowsCompression = null,
  emitArtifacts = 'jsonl',
  enqueueWrite,
  addPieceFile,
  formatArtifactLabel,
  log = null,
  callSitesRef = null
}) => {
  const stats = state?.riskInterproceduralStats && typeof state.riskInterproceduralStats === 'object'
    ? { ...state.riskInterproceduralStats }
    : null;
  const summaries = Array.isArray(state?.riskSummaries) ? state.riskSummaries : [];
  const flows = Array.isArray(state?.riskFlows) ? state.riskFlows : [];
  const allowArtifacts = emitArtifacts !== 'none';
  const flowsExpected = stats?.status === 'ok' && stats?.effectiveConfig?.summaryOnly !== true;

  let summariesRef = null;
  let flowsRef = null;
  if (allowArtifacts) {
    summariesRef = writeJsonlArtifact({
      name: 'risk_summaries',
      rows: summaries,
      outDir,
      maxJsonBytes,
      compression,
      gzipOptions,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      log,
      forceEmpty: true
    });
    if (flowsExpected) {
      flowsRef = writeJsonlArtifact({
        name: 'risk_flows',
        rows: flows,
        outDir,
        maxJsonBytes,
        compression: flowsCompression || compression,
        gzipOptions,
        enqueueWrite,
        addPieceFile,
        formatArtifactLabel,
        log,
        forceEmpty: true
      });
    }
  }

  const finalStats = stats
    ? buildRiskInterproceduralStats({
      stats,
      summariesRef,
      flowsRef,
      callSitesRef
    })
    : null;

  if (finalStats) {
    const statsPath = path.join(outDir, 'risk_interprocedural_stats.json');
    enqueueWrite(
      formatArtifactLabel(statsPath),
      () => writeJsonObjectFile(statsPath, { fields: finalStats, atomic: true })
    );
    addPieceFile({ type: 'risk', name: 'risk_interprocedural_stats', format: 'json' }, statsPath);
  }

  return { summariesRef, flowsRef, stats: finalStats };
};
