import fsSync from 'node:fs';
import { resolveHnswPaths, resolveHnswTarget } from '../../../../src/shared/hnsw.js';
import { resolveLanceDbPaths, resolveLanceDbTarget } from '../../../../src/shared/lancedb.js';

/**
 * Probe published ANN backend availability and metadata from the active index
 * directory.
 *
 * Sequencing contract: call this only after stage3 has promoted backend
 * artifacts from staging into `indexDir`. Probing earlier can race staging IO
 * and emit false negatives while artifacts are still isolated.
 *
 * @param {{
 *   mode:string,
 *   indexDir:string,
 *   denseVectorMode:string,
 *   hnswConfig:{enabled?:boolean},
 *   lanceConfig:{enabled?:boolean},
 *   finalDims:number,
 *   totalChunks:number,
 *   scheduleIo:(worker:()=>Promise<any>)=>Promise<any>,
 *   readJsonOptional:(filePath:string)=>object|null
 * }} input
 * @returns {Promise<{hnswState:object,lancedbState:object}>}
 */
export const resolvePublishedBackendStates = async ({
  mode,
  indexDir,
  denseVectorMode,
  hnswConfig,
  lanceConfig,
  finalDims,
  totalChunks,
  scheduleIo,
  readJsonOptional
}) => {
  const hnswTarget = resolveHnswTarget(mode, denseVectorMode);
  const hnswTargetPaths = resolveHnswPaths(indexDir, hnswTarget);
  const lancePaths = resolveLanceDbPaths(indexDir);
  const lanceTarget = resolveLanceDbTarget(mode, denseVectorMode);
  const targetPaths = lancePaths?.[lanceTarget] || lancePaths?.merged || {};

  const [hnswMeta, lanceMeta] = await Promise.all([
    scheduleIo(() => readJsonOptional(hnswTargetPaths.metaPath)),
    scheduleIo(() => readJsonOptional(targetPaths.metaPath))
  ]);

  const hnswIndexExists = fsSync.existsSync(hnswTargetPaths.indexPath)
    || fsSync.existsSync(`${hnswTargetPaths.indexPath}.bak`);
  const hnswAvailable = Boolean(hnswMeta) && hnswIndexExists;
  const hnswState = {
    enabled: hnswConfig.enabled !== false,
    available: hnswAvailable,
    target: hnswTarget
  };
  if (hnswMeta) {
    hnswState.dims = Number.isFinite(Number(hnswMeta.dims)) ? Number(hnswMeta.dims) : finalDims;
    hnswState.count = Number.isFinite(Number(hnswMeta.count)) ? Number(hnswMeta.count) : totalChunks;
  }

  const lanceAvailable = Boolean(lanceMeta)
    && Boolean(targetPaths.dir)
    && fsSync.existsSync(targetPaths.dir);
  const lancedbState = {
    enabled: lanceConfig.enabled !== false,
    available: lanceAvailable,
    target: lanceTarget
  };
  if (lanceMeta) {
    lancedbState.dims = Number.isFinite(Number(lanceMeta.dims)) ? Number(lanceMeta.dims) : finalDims;
    lancedbState.count = Number.isFinite(Number(lanceMeta.count)) ? Number(lanceMeta.count) : totalChunks;
  }

  return {
    hnswState,
    lancedbState
  };
};
