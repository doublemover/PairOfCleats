import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { log, logLine, showProgress } from '../../shared/progress.js';
import { MAX_JSON_BYTES, readJsonFile, loadJsonArrayArtifact } from '../../shared/artifact-io.js';
import { resolveArtifactCompressionTier } from '../../shared/artifact-io/compression.js';
import { toPosix } from '../../shared/files.js';
import { writeJsonObjectFile } from '../../shared/json-stream.js';
import { createJsonWriteStream, writeChunk } from '../../shared/json-stream/streams.js';
import { normalizePostingsConfig } from '../../shared/postings-config.js';
import { ensureDiskSpace } from '../../shared/disk-space.js';
import { estimateJsonBytes } from '../../shared/cache.js';
import { buildCacheKey } from '../../shared/cache-key.js';
import { sha1 } from '../../shared/hash.js';
import { stableStringifyForSignature } from '../../shared/stable-json.js';
import { resolveCompressionConfig } from './artifacts/compression.js';
import { getToolingConfig } from '../../shared/dict-utils.js';
import { writePiecesManifest } from './artifacts/checksums.js';
import { writeFileLists } from './artifacts/file-lists.js';
import { buildFileMeta, buildFileMetaColumnar, computeFileMetaFingerprint } from './artifacts/file-meta.js';
import { buildSerializedFilterIndex } from './artifacts/filter-index.js';
import { enqueueGraphRelationsArtifacts } from './artifacts/graph-relations.js';
import { writeIndexMetrics } from './artifacts/metrics.js';
import { enqueueRepoMapArtifacts, measureRepoMap } from './artifacts/repo-map.js';
import { SCHEDULER_QUEUE_NAMES } from './runtime/scheduler.js';
import {
  enqueueTokenPostingsArtifacts,
  resolveTokenPostingsPlan
} from './artifacts/token-postings.js';
import { resolveTokenMode } from './artifacts/token-mode.js';
import { createArtifactWriter } from './artifacts/writer.js';
import { formatBytes, summarizeFilterIndex } from './artifacts/helpers.js';
import { enqueueFileRelationsArtifacts } from './artifacts/writers/file-relations.js';
import { enqueueCallSitesArtifacts } from './artifacts/writers/call-sites.js';
import { enqueueRiskInterproceduralArtifacts } from './artifacts/writers/risk-interprocedural.js';
import { enqueueSymbolsArtifacts } from './artifacts/writers/symbols.js';
import { enqueueSymbolOccurrencesArtifacts } from './artifacts/writers/symbol-occurrences.js';
import { enqueueSymbolEdgesArtifacts } from './artifacts/writers/symbol-edges.js';
import { createRepoMapIterator } from './artifacts/writers/repo-map.js';
import {
  createChunkMetaIterator,
  enqueueChunkMetaArtifacts,
  resolveChunkMetaPlan,
  resolveChunkMetaOrder,
  resolveChunkMetaOrderById
} from './artifacts/writers/chunk-meta.js';
import { enqueueChunkUidMapArtifacts } from './artifacts/writers/chunk-uid-map.js';
import { enqueueVfsManifestArtifacts } from './artifacts/writers/vfs-manifest.js';
import { recordOrderingHash, updateBuildState } from './build-state.js';
import { applyByteBudget, resolveByteBudgetMap } from './byte-budget.js';
import { CHARGRAM_HASH_META } from '../../shared/chargram-hash.js';
import { createOrderingHasher } from '../../shared/order.js';
import { computePackedChecksum } from '../../shared/artifact-io/checksum.js';
import {
  resolveBinaryColumnarWriteHints,
  writeBinaryRowFrames
} from '../../shared/artifact-io/binary-columnar.js';
import {
  INDEX_PROFILE_VECTOR_ONLY,
  normalizeIndexProfileId
} from '../../contracts/index-profile.js';
import { resolveArtifactWriteConcurrency } from './artifacts/write-concurrency.js';
import {
  buildDeterminismReport,
  buildExtractionReport,
  buildLexiconRelationFilterReport,
  stripIndexStateNondeterministicFields
} from './artifacts/reporting.js';
import {
  cleanupVectorOnlySparseArtifacts,
  getLingeringSparseArtifacts,
  removeCompressedArtifact,
  removePackedMinhash,
  removePackedPostings,
  VECTOR_ONLY_SPARSE_PIECE_DENYLIST
} from './artifacts/sparse-cleanup.js';
import { packMinhashSignatures } from './artifacts/minhash-packed.js';

export {
  resolveArtifactWriteConcurrency,
  buildLexiconRelationFilterReport,
  resolveArtifactLaneConcurrency,
  resolveArtifactLaneConcurrencyWithUltraLight,
  resolveArtifactLaneConcurrencyWithMassive,
  resolveArtifactWorkClassConcurrency,
  createAdaptiveWriteConcurrencyController,
  resolveWriteStartTimestampMs,
  resolveArtifactWriteFsStrategy,
  resolveArtifactWriteLatencyClass,
  selectTailWorkerWriteEntry,
  selectMicroWriteBatch
};

/**
 * Aggregate per-chunk boilerplate metadata into a compact reference catalog.
 *
 * @param {Array<object>} chunks
 * @returns {Array<{ref:string,count:number,positions:Record<string,number>,tags:Array<string>,sampleFiles:Array<string>}>}
 */
const buildBoilerplateCatalog = (chunks) => {
  if (!Array.isArray(chunks) || !chunks.length) return [];
  const byRef = new Map();
  for (const chunk of chunks) {
    const docmeta = chunk?.docmeta;
    const ref = typeof docmeta?.boilerplateRef === 'string' ? docmeta.boilerplateRef : null;
    if (!ref) continue;
    const row = byRef.get(ref) || {
      ref,
      count: 0,
      positions: {},
      tags: new Set(),
      sampleFiles: []
    };
    row.count += 1;
    const position = typeof docmeta?.boilerplatePosition === 'string'
      ? docmeta.boilerplatePosition
      : 'unknown';
    row.positions[position] = (row.positions[position] || 0) + 1;
    const tags = Array.isArray(docmeta?.boilerplateTags) ? docmeta.boilerplateTags : [];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.trim()) row.tags.add(tag.trim());
    }
    const file = typeof chunk?.file === 'string' ? chunk.file : null;
    if (file && row.sampleFiles.length < 8 && !row.sampleFiles.includes(file)) {
      row.sampleFiles.push(file);
    }
    byRef.set(ref, row);
  }
  return Array.from(byRef.values())
    .map((row) => ({
      ref: row.ref,
      count: row.count,
      positions: row.positions,
      tags: Array.from(row.tags).sort(),
      sampleFiles: row.sampleFiles
    }))
    .sort((a, b) => b.count - a.count || a.ref.localeCompare(b.ref));
};

/**
 * Resolve write-lane concurrency for light/heavy artifact queues.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{heavyConcurrency:number,lightConcurrency:number}}
 */
const resolveArtifactLaneConcurrency = ({
  writeConcurrency,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  const availableHostConcurrency = Math.max(1, Math.floor(Number(hostConcurrency) || 1));
  const heavyOverride = Number(heavyWriteConcurrencyOverride);
  const dynamicHeavyTarget = Number.isFinite(heavyOverride) && heavyOverride > 0
    ? Math.max(1, Math.floor(heavyOverride))
    : (heavyWriteCount >= 8 && availableHostConcurrency >= 8
      ? Math.max(1, Math.ceil(totalWriteConcurrency * 0.66))
      : Math.max(1, Math.ceil(totalWriteConcurrency / 2)));

  const hasHeavy = heavyWriteCount > 0;
  const hasLight = lightWriteCount > 0;

  if (!hasHeavy && !hasLight) {
    return { heavyConcurrency: 0, lightConcurrency: 0 };
  }
  if (!hasHeavy) {
    return {
      heavyConcurrency: 0,
      lightConcurrency: Math.min(totalWriteConcurrency, lightWriteCount)
    };
  }
  if (!hasLight) {
    return {
      // Heavy-only queues should consume full writer concurrency; memory pressure
      // is already bounded by scheduler tokens and per-write mem costs.
      heavyConcurrency: Math.min(totalWriteConcurrency, heavyWriteCount),
      lightConcurrency: 0
    };
  }

  const heavySkewedBacklog = heavyWriteCount >= Math.max(4, lightWriteCount * 2);
  const lightReserveRatio = heavySkewedBacklog ? 0.2 : 0.33;
  const lightReserveFloor = heavySkewedBacklog ? 2 : 1;
  const lightReserveCap = Math.max(0, totalWriteConcurrency - 1);
  const effectiveLightReserveFloor = Math.min(lightReserveCap, lightReserveFloor);
  const lightReserve = lightReserveCap > 0
    ? Math.max(
      effectiveLightReserveFloor,
      Math.min(
        lightWriteCount,
        lightReserveCap,
        Math.ceil(totalWriteConcurrency * lightReserveRatio)
      )
    )
    : 0;
  const maxHeavyBudget = Math.max(1, totalWriteConcurrency - lightReserve);
  let heavyConcurrency = Math.max(
    1,
    Math.min(heavyWriteCount, dynamicHeavyTarget, maxHeavyBudget)
  );
  let lightConcurrencyBudget = Math.max(0, totalWriteConcurrency - heavyConcurrency);
  const minimumLightBudget = Math.min(lightWriteCount, lightReserve);
  if (lightConcurrencyBudget < minimumLightBudget && heavyConcurrency > 1) {
    const shift = Math.min(
      minimumLightBudget - lightConcurrencyBudget,
      heavyConcurrency - 1
    );
    heavyConcurrency -= shift;
    lightConcurrencyBudget += shift;
  }
  const lightConcurrency = Math.min(lightWriteCount, lightConcurrencyBudget);

  return {
    heavyConcurrency,
    lightConcurrency
  };
};

/**
 * Resolve write-lane concurrency when an ultra-light queue is present.
 *
 * Ultra-light artifacts reserve at least one slot (bounded) whenever mixed with
 * other lanes so tiny metadata writes never wait behind long heavy tails.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.ultraLightWrites
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{ultraLightConcurrency:number,lightConcurrency:number,heavyConcurrency:number}}
 */
const resolveArtifactLaneConcurrencyWithUltraLight = ({
  writeConcurrency,
  ultraLightWrites,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const ultraLightWriteCount = Math.max(0, Math.floor(Number(ultraLightWrites) || 0));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  if (!ultraLightWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: Math.min(totalWriteConcurrency, ultraLightWriteCount),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const ultraLightReserveTarget = ultraLightWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.25)))
    : 0;
  const maxUltraReserve = Math.max(0, totalWriteConcurrency - 1);
  let ultraLightConcurrency = ultraLightWriteCount > 0
    ? Math.min(ultraLightWriteCount, ultraLightReserveTarget, maxUltraReserve)
    : 0;
  if (ultraLightWriteCount > 0 && ultraLightConcurrency < 1 && totalWriteConcurrency > 0) {
    ultraLightConcurrency = 1;
  }
  const remainingConcurrency = Math.max(0, totalWriteConcurrency - ultraLightConcurrency);
  if (remainingConcurrency <= 0) {
    return {
      ultraLightConcurrency,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  const base = resolveArtifactLaneConcurrency({
    writeConcurrency: remainingConcurrency,
    lightWrites: lightWriteCount,
    heavyWrites: heavyWriteCount,
    heavyWriteConcurrencyOverride,
    hostConcurrency
  });
  if (base.lightConcurrency === 0 && base.heavyConcurrency === 0 && ultraLightWriteCount > 0) {
    ultraLightConcurrency = Math.min(totalWriteConcurrency, ultraLightWriteCount);
  }
  return {
    ultraLightConcurrency,
    lightConcurrency: base.lightConcurrency,
    heavyConcurrency: base.heavyConcurrency
  };
};

/**
 * Resolve lane concurrency with ultra-light + massive write lanes.
 *
 * Massive artifacts reserve dedicated slots and tokens so very large outputs
 * (packed/binary-columnar/field postings) do not monopolize the general lane.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.ultraLightWrites
 * @param {number} input.massiveWrites
 * @param {number} input.lightWrites
 * @param {number} input.heavyWrites
 * @param {number|null} [input.heavyWriteConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{ultraLightConcurrency:number,massiveConcurrency:number,lightConcurrency:number,heavyConcurrency:number}}
 */
const resolveArtifactLaneConcurrencyWithMassive = ({
  writeConcurrency,
  ultraLightWrites,
  massiveWrites,
  lightWrites,
  heavyWrites,
  heavyWriteConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const ultraLightWriteCount = Math.max(0, Math.floor(Number(ultraLightWrites) || 0));
  const massiveWriteCount = Math.max(0, Math.floor(Number(massiveWrites) || 0));
  const lightWriteCount = Math.max(0, Math.floor(Number(lightWrites) || 0));
  const heavyWriteCount = Math.max(0, Math.floor(Number(heavyWrites) || 0));
  if (!ultraLightWriteCount && !massiveWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      massiveConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!massiveWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: Math.min(totalWriteConcurrency, ultraLightWriteCount),
      massiveConcurrency: 0,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  if (!ultraLightWriteCount && !lightWriteCount && !heavyWriteCount) {
    return {
      ultraLightConcurrency: 0,
      massiveConcurrency: Math.min(totalWriteConcurrency, massiveWriteCount),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const nonUltraWriteCount = massiveWriteCount + lightWriteCount + heavyWriteCount;
  const ultraLightReserveTarget = ultraLightWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.25)))
    : 0;
  const maxUltraReserve = Math.max(0, totalWriteConcurrency - (nonUltraWriteCount > 0 ? 1 : 0));
  let ultraLightConcurrency = ultraLightWriteCount > 0
    ? Math.min(ultraLightWriteCount, ultraLightReserveTarget, maxUltraReserve)
    : 0;
  if (ultraLightWriteCount > 0 && ultraLightConcurrency < 1 && totalWriteConcurrency > 0) {
    ultraLightConcurrency = 1;
  }

  const regularWriteCount = lightWriteCount + heavyWriteCount;
  const remainingAfterUltra = Math.max(0, totalWriteConcurrency - ultraLightConcurrency);
  if (regularWriteCount === 0) {
    return {
      ultraLightConcurrency,
      massiveConcurrency: Math.min(massiveWriteCount, remainingAfterUltra),
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }
  const massiveReserveTarget = massiveWriteCount > 0
    ? Math.max(1, Math.min(2, Math.ceil(totalWriteConcurrency * 0.33)))
    : 0;
  const maxMassiveReserve = Math.max(0, remainingAfterUltra - (regularWriteCount > 0 ? 1 : 0));
  let massiveConcurrency = massiveWriteCount > 0
    ? Math.min(massiveWriteCount, massiveReserveTarget, maxMassiveReserve)
    : 0;
  if (
    massiveWriteCount > 0
    && massiveConcurrency < 1
    && remainingAfterUltra > 0
    && regularWriteCount > 0
  ) {
    massiveConcurrency = 1;
  }

  const remainingConcurrency = Math.max(
    0,
    totalWriteConcurrency - ultraLightConcurrency - massiveConcurrency
  );
  if (remainingConcurrency <= 0) {
    return {
      ultraLightConcurrency,
      massiveConcurrency,
      lightConcurrency: 0,
      heavyConcurrency: 0
    };
  }

  const base = resolveArtifactLaneConcurrency({
    writeConcurrency: remainingConcurrency,
    lightWrites: lightWriteCount,
    heavyWrites: heavyWriteCount,
    heavyWriteConcurrencyOverride,
    hostConcurrency
  });
  return {
    ultraLightConcurrency,
    massiveConcurrency,
    lightConcurrency: base.lightConcurrency,
    heavyConcurrency: base.heavyConcurrency
  };
};

/**
 * Resolve independent work-class concurrency budgets.
 *
 * Work classes map to write lanes as:
 * `small -> ultraLight+light`, `medium -> heavy`, `large -> massive`.
 *
 * @param {object} input
 * @param {number} input.writeConcurrency
 * @param {number} input.smallWrites
 * @param {number} input.mediumWrites
 * @param {number} input.largeWrites
 * @param {number|null} [input.smallConcurrencyOverride]
 * @param {number|null} [input.mediumConcurrencyOverride]
 * @param {number|null} [input.largeConcurrencyOverride]
 * @param {number} [input.hostConcurrency]
 * @returns {{smallConcurrency:number,mediumConcurrency:number,largeConcurrency:number}}
 */
const resolveArtifactWorkClassConcurrency = ({
  writeConcurrency,
  smallWrites,
  mediumWrites,
  largeWrites,
  smallConcurrencyOverride = null,
  mediumConcurrencyOverride = null,
  largeConcurrencyOverride = null,
  hostConcurrency = 1
}) => {
  const totalWriteConcurrency = Math.max(1, Math.floor(Number(writeConcurrency) || 1));
  const smallWriteCount = Math.max(0, Math.floor(Number(smallWrites) || 0));
  const mediumWriteCount = Math.max(0, Math.floor(Number(mediumWrites) || 0));
  const largeWriteCount = Math.max(0, Math.floor(Number(largeWrites) || 0));
  if (!smallWriteCount && !mediumWriteCount && !largeWriteCount) {
    return {
      smallConcurrency: 0,
      mediumConcurrency: 0,
      largeConcurrency: 0
    };
  }

  const parseOverride = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.max(1, Math.floor(parsed));
  };
  const clampToWrites = (value, count) => Math.max(0, Math.min(count, Math.floor(Number(value) || 0)));

  const seeded = resolveArtifactLaneConcurrencyWithMassive({
    writeConcurrency: totalWriteConcurrency,
    ultraLightWrites: 0,
    massiveWrites: largeWriteCount,
    lightWrites: smallWriteCount,
    heavyWrites: mediumWriteCount,
    hostConcurrency
  });

  const smallOverride = parseOverride(smallConcurrencyOverride);
  const mediumOverride = parseOverride(mediumConcurrencyOverride);
  const largeOverride = parseOverride(largeConcurrencyOverride);
  let budgets = {
    smallConcurrency: clampToWrites(
      smallOverride ?? seeded.lightConcurrency,
      smallWriteCount
    ),
    mediumConcurrency: clampToWrites(
      mediumOverride ?? seeded.heavyConcurrency,
      mediumWriteCount
    ),
    largeConcurrency: clampToWrites(
      largeOverride ?? seeded.massiveConcurrency,
      largeWriteCount
    )
  };

  let totalBudget = budgets.smallConcurrency + budgets.mediumConcurrency + budgets.largeConcurrency;
  if (totalBudget > totalWriteConcurrency) {
    let overflow = totalBudget - totalWriteConcurrency;
    for (const className of ['smallConcurrency', 'mediumConcurrency', 'largeConcurrency']) {
      if (overflow <= 0) break;
      const shift = Math.min(overflow, budgets[className]);
      budgets[className] -= shift;
      overflow -= shift;
    }
    totalBudget = budgets.smallConcurrency + budgets.mediumConcurrency + budgets.largeConcurrency;
  }

  if (totalBudget < totalWriteConcurrency) {
    let spare = totalWriteConcurrency - totalBudget;
    const remainingCapacity = {
      largeConcurrency: Math.max(0, largeWriteCount - budgets.largeConcurrency),
      mediumConcurrency: Math.max(0, mediumWriteCount - budgets.mediumConcurrency),
      smallConcurrency: Math.max(0, smallWriteCount - budgets.smallConcurrency)
    };
    for (const className of ['largeConcurrency', 'mediumConcurrency', 'smallConcurrency']) {
      if (spare <= 0) break;
      const grow = Math.min(spare, remainingCapacity[className]);
      budgets[className] += grow;
      spare -= grow;
    }
  }

  return budgets;
};

const clampWriteConcurrency = (value, fallback = 1) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Math.max(1, Math.floor(Number(fallback) || 1));
  }
  return Math.max(1, Math.floor(parsed));
};

/**
 * Resolve artifact write start timestamp for queue-delay/stall telemetry.
 *
 * Prefetched writes may provide a pre-dispatch timestamp; non-prefetched
 * writes should use the current dispatch time instead of coercing nullish
 * values (for example `Number(null) === 0`, which skews elapsed metrics).
 *
 * @param {number|string|null|undefined} prefetchedStartMs
 * @param {number} [fallbackNowMs]
 * @returns {number}
 */
const resolveWriteStartTimestampMs = (prefetchedStartMs, fallbackNowMs = Date.now()) => {
  const fallback = Number.isFinite(Number(fallbackNowMs))
    ? Number(fallbackNowMs)
    : Date.now();
  const prefetched = Number(prefetchedStartMs);
  if (Number.isFinite(prefetched) && prefetched > 0) return prefetched;
  return fallback;
};

/**
 * Adaptive write-concurrency controller for artifact writes.
 *
 * Concurrency scales up with backlog pressure and scales down when write stalls
 * are sustained, replacing fixed-cap behavior during long write tails.
 *
 * @param {object} input
 * @param {number} input.maxConcurrency
 * @param {number} [input.minConcurrency]
 * @param {number|null} [input.initialConcurrency]
 * @param {number} [input.scaleUpBacklogPerSlot]
 * @param {number} [input.scaleDownBacklogPerSlot]
 * @param {number} [input.stallScaleDownSeconds]
 * @param {number} [input.stallScaleUpGuardSeconds]
 * @param {number} [input.scaleUpCooldownMs]
 * @param {number} [input.scaleDownCooldownMs]
 * @param {() => number} [input.now]
 * @param {(event:{reason:string,from:number,to:number,pendingWrites:number,activeWrites:number,longestStallSec:number}) => void} [input.onChange]
 * @returns {{observe:(snapshot?:{pendingWrites?:number,activeWrites?:number,longestStallSec?:number})=>number,getCurrentConcurrency:()=>number,getLimits:()=>{min:number,max:number}}}
 */
const createAdaptiveWriteConcurrencyController = (input = {}) => {
  const maxConcurrency = clampWriteConcurrency(input.maxConcurrency, 1);
  const minConcurrency = Math.min(
    maxConcurrency,
    clampWriteConcurrency(input.minConcurrency, 1)
  );
  const initialFallback = Math.max(
    minConcurrency,
    Math.min(maxConcurrency, Math.ceil(maxConcurrency * 0.6))
  );
  let currentConcurrency = clampWriteConcurrency(input.initialConcurrency, initialFallback);
  currentConcurrency = Math.max(minConcurrency, Math.min(maxConcurrency, currentConcurrency));
  const scaleUpBacklogPerSlot = Number.isFinite(Number(input.scaleUpBacklogPerSlot))
    ? Math.max(1, Number(input.scaleUpBacklogPerSlot))
    : 1.75;
  const scaleDownBacklogPerSlot = Number.isFinite(Number(input.scaleDownBacklogPerSlot))
    ? Math.max(0, Number(input.scaleDownBacklogPerSlot))
    : 0.5;
  const stallScaleDownSeconds = Number.isFinite(Number(input.stallScaleDownSeconds))
    ? Math.max(1, Math.floor(Number(input.stallScaleDownSeconds)))
    : 20;
  const stallScaleUpGuardSeconds = Number.isFinite(Number(input.stallScaleUpGuardSeconds))
    ? Math.max(1, Math.floor(Number(input.stallScaleUpGuardSeconds)))
    : 8;
  const scaleUpCooldownMs = Number.isFinite(Number(input.scaleUpCooldownMs))
    ? Math.max(0, Math.floor(Number(input.scaleUpCooldownMs)))
    : 400;
  const scaleDownCooldownMs = Number.isFinite(Number(input.scaleDownCooldownMs))
    ? Math.max(0, Math.floor(Number(input.scaleDownCooldownMs)))
    : 1200;
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const onChange = typeof input.onChange === 'function' ? input.onChange : null;

  let lastScaleUpAt = Number.NEGATIVE_INFINITY;
  let lastScaleDownAt = Number.NEGATIVE_INFINITY;

  const emitChange = (reason, from, to, snapshot) => {
    if (!onChange || from === to) return;
    onChange({
      reason,
      from,
      to,
      pendingWrites: snapshot.pendingWrites,
      activeWrites: snapshot.activeWrites,
      longestStallSec: snapshot.longestStallSec
    });
  };

  const observe = (snapshot = {}) => {
    const pendingWrites = Math.max(0, Math.floor(Number(snapshot.pendingWrites) || 0));
    const activeWrites = Math.max(0, Math.floor(Number(snapshot.activeWrites) || 0));
    const longestStallSec = Number.isFinite(Number(snapshot.longestStallSec))
      ? Math.max(0, Number(snapshot.longestStallSec))
      : 0;
    const nowValue = now();
    const timestamp = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now();
    const backlogPerSlot = pendingWrites / Math.max(1, currentConcurrency);
    const from = currentConcurrency;

    const canScaleDown = currentConcurrency > minConcurrency
      && (timestamp - lastScaleDownAt) >= scaleDownCooldownMs;
    if (
      canScaleDown
      && pendingWrites > 0
      && longestStallSec >= stallScaleDownSeconds
      && backlogPerSlot <= Math.max(1, scaleUpBacklogPerSlot)
    ) {
      currentConcurrency -= 1;
      lastScaleDownAt = timestamp;
      emitChange('stall', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec
      });
      return currentConcurrency;
    }
    if (
      canScaleDown
      && pendingWrites <= 1
      && activeWrites < currentConcurrency
      && backlogPerSlot <= scaleDownBacklogPerSlot
    ) {
      currentConcurrency -= 1;
      lastScaleDownAt = timestamp;
      emitChange('drain', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec
      });
      return currentConcurrency;
    }

    const canScaleUp = currentConcurrency < maxConcurrency
      && (timestamp - lastScaleUpAt) >= scaleUpCooldownMs;
    if (
      canScaleUp
      && pendingWrites > 0
      && backlogPerSlot >= scaleUpBacklogPerSlot
      && longestStallSec <= stallScaleUpGuardSeconds
    ) {
      currentConcurrency += 1;
      lastScaleUpAt = timestamp;
      emitChange('backlog', from, currentConcurrency, {
        pendingWrites,
        activeWrites,
        longestStallSec
      });
    }
    return currentConcurrency;
  };

  return {
    observe,
    getCurrentConcurrency: () => currentConcurrency,
    getLimits: () => ({ min: minConcurrency, max: maxConcurrency })
  };
};

const LARGE_ARTIFACT_WRITE_BYTES = 256 * 1024 * 1024;
const HUGE_ARTIFACT_WRITE_BYTES = 768 * 1024 * 1024;
const ARTIFACT_QUEUE_DELAY_BUCKETS_MS = Object.freeze([
  0,
  1,
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  512,
  1000,
  2000,
  5000,
  10000,
  30000,
  60000
]);
const ARTIFACT_LATENCY_CLASSES = Object.freeze([
  { maxMs: 64, name: 'instant' },
  { maxMs: 256, name: 'fast' },
  { maxMs: 1000, name: 'steady' },
  { maxMs: 4000, name: 'slow' }
]);
const ARTIFACT_SIZE_CLASSES = Object.freeze([
  { maxBytes: 64 * 1024, name: 'micro' },
  { maxBytes: 1024 * 1024, name: 'small' },
  { maxBytes: 16 * 1024 * 1024, name: 'medium' },
  { maxBytes: 128 * 1024 * 1024, name: 'large' }
]);
const VALIDATION_CRITICAL_ARTIFACT_PATTERNS = Object.freeze([
  /(^|\/)index_state\.json$/,
  /(^|\/)metrics\.json$/,
  /(^|\/)chunk_meta(?:\.|$)/,
  /(^|\/)file_meta(?:\.|$)/,
  /(^|\/)token_postings(?:\.|$)/,
  /(^|\/)field_postings(?:\.|$)/,
  /(^|\/)pieces\/manifest\.json$/
]);

/**
 * Estimate scheduler memory-token cost for a single artifact write.
 *
 * Small/medium writes are primarily IO-bound and should not be throttled by
 * memory tokens. Very large writes still consume explicit memory budget.
 *
 * @param {number|null|undefined} estimatedBytes
 * @returns {number}
 */
const resolveArtifactWriteMemTokens = (estimatedBytes) => {
  const bytes = Number(estimatedBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  if (bytes >= HUGE_ARTIFACT_WRITE_BYTES) return 2;
  if (bytes >= LARGE_ARTIFACT_WRITE_BYTES) return 1;
  return 0;
};

const resolvePercentileMs = (samples, ratio) => {
  if (!Array.isArray(samples) || !samples.length) return 0;
  if (!Number.isFinite(ratio)) return samples[0];
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  const index = Math.min(samples.length - 1, Math.max(0, Math.ceil(clampedRatio * samples.length) - 1));
  return samples[index];
};

const summarizeQueueDelayHistogram = (samples) => {
  if (!Array.isArray(samples) || !samples.length) return null;
  const normalized = samples
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.round(entry))
    .sort((a, b) => a - b);
  if (!normalized.length) return null;
  const bucketCounts = new Array(ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length).fill(0);
  let overflowCount = 0;
  for (const value of normalized) {
    let bucketIndex = -1;
    for (let index = 0; index < ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length; index += 1) {
      if (value <= ARTIFACT_QUEUE_DELAY_BUCKETS_MS[index]) {
        bucketIndex = index;
        break;
      }
    }
    if (bucketIndex >= 0) bucketCounts[bucketIndex] += 1;
    else overflowCount += 1;
  }
  const buckets = [];
  for (let index = 0; index < ARTIFACT_QUEUE_DELAY_BUCKETS_MS.length; index += 1) {
    const count = bucketCounts[index];
    if (!count) continue;
    buckets.push({
      leMs: ARTIFACT_QUEUE_DELAY_BUCKETS_MS[index],
      count
    });
  }
  return {
    unit: 'ms',
    sampleCount: normalized.length,
    minMs: normalized[0],
    maxMs: normalized[normalized.length - 1],
    p50Ms: resolvePercentileMs(normalized, 0.5),
    p95Ms: resolvePercentileMs(normalized, 0.95),
    buckets,
    overflowCount
  };
};

const isValidationCriticalArtifact = (label) => (
  typeof label === 'string' && VALIDATION_CRITICAL_ARTIFACT_PATTERNS.some((pattern) => pattern.test(label))
);

const resolveOptionalPositiveNumber = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const resolveArtifactWriteThroughputProfile = (perfProfile) => {
  const candidates = [
    perfProfile?.indexOptimizationProfile?.artifactWrite?.throughputBytesPerSec,
    perfProfile?.indexOptimizationProfile?.artifactWriteThroughputBytesPerSec,
    perfProfile?.artifactWrite?.throughputBytesPerSec,
    perfProfile?.artifactWriteThroughputBytesPerSec,
    perfProfile?.storage?.writeBytesPerSec
  ];
  for (const candidate of candidates) {
    const throughput = resolveOptionalPositiveNumber(candidate, null);
    if (throughput != null) return throughput;
  }
  return null;
};

const normalizeStrategyMode = (value) => {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : 'auto';
  if (mode === 'ntfs' || mode === 'generic' || mode === 'auto') return mode;
  return 'auto';
};

const toNonNegativeNumberOrNull = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
};

/**
 * Resolve filesystem strategy toggles for artifact writes.
 *
 * @param {{artifactConfig?:object,platform?:string}} [input]
 * @returns {{mode:'ntfs'|'generic',detectedNtfs:boolean,microCoalescing:boolean,tailWorker:boolean,presizeJsonl:boolean,microBatchMaxCount:number,microBatchMaxBytes:number}}
 */
const resolveArtifactWriteFsStrategy = (input = {}) => {
  const artifactConfig = input?.artifactConfig && typeof input.artifactConfig === 'object'
    ? input.artifactConfig
    : {};
  const platform = typeof input?.platform === 'string'
    ? input.platform
    : process.platform;
  const detectedNtfs = platform === 'win32';
  const explicitMode = normalizeStrategyMode(artifactConfig.writeFsStrategy);
  const legacyNtfsStrategy = artifactConfig.writeNtfsStrategy;
  let mode = explicitMode === 'auto'
    ? (detectedNtfs ? 'ntfs' : 'generic')
    : explicitMode;
  if (legacyNtfsStrategy === true) mode = 'ntfs';
  if (legacyNtfsStrategy === false) mode = 'generic';
  const ntfsMode = mode === 'ntfs';
  const microBatchMaxCount = Number.isFinite(Number(artifactConfig.writeMicroCoalesceMaxBatchCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.writeMicroCoalesceMaxBatchCount)))
    : (ntfsMode ? 12 : 8);
  const microBatchMaxBytes = Number.isFinite(Number(artifactConfig.writeMicroCoalesceMaxBatchBytes))
    ? Math.max(16 * 1024, Math.floor(Number(artifactConfig.writeMicroCoalesceMaxBatchBytes)))
    : (ntfsMode ? 512 * 1024 : 256 * 1024);
  return {
    mode,
    detectedNtfs,
    microCoalescing: artifactConfig.writeMicroCoalesce !== false,
    tailWorker: artifactConfig.writeTailWorker !== false,
    presizeJsonl: artifactConfig.writeJsonlPresize !== false,
    microBatchMaxCount,
    microBatchMaxBytes
  };
};

const resolveArtifactWriteSizeClass = (metric = {}) => {
  const bytes = toNonNegativeNumberOrNull(metric?.bytes) ?? toNonNegativeNumberOrNull(metric?.estimatedBytes);
  if (bytes == null) return 'unknown';
  for (const threshold of ARTIFACT_SIZE_CLASSES) {
    if (bytes <= threshold.maxBytes) return threshold.name;
  }
  return 'huge';
};

/**
 * Classify per-artifact write latency into stable buckets for telemetry.
 *
 * @param {{queueDelayMs?:number,durationMs?:number,bytes?:number,estimatedBytes?:number}} metric
 * @returns {string}
 */
const resolveArtifactWriteLatencyClass = (metric = {}) => {
  const queueDelayMs = Math.max(0, Number(metric?.queueDelayMs) || 0);
  const durationMs = Math.max(0, Number(metric?.durationMs) || 0);
  const totalMs = queueDelayMs + durationMs;
  const sizeClass = resolveArtifactWriteSizeClass(metric);
  if (queueDelayMs >= 2000 || totalMs > 4000) return `${sizeClass}:tail`;
  for (const threshold of ARTIFACT_LATENCY_CLASSES) {
    if (totalMs <= threshold.maxMs) return `${sizeClass}:${threshold.name}`;
  }
  return `${sizeClass}:tail`;
};

const summarizeArtifactLatencyClasses = (metrics) => {
  if (!Array.isArray(metrics) || !metrics.length) return null;
  const counts = {};
  for (const metric of metrics) {
    const latencyClass = resolveArtifactWriteLatencyClass(metric);
    counts[latencyClass] = (counts[latencyClass] || 0) + 1;
  }
  const classes = Object.keys(counts)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, count: counts[name] }));
  return {
    total: metrics.length,
    classes
  };
};

const resolveTailWorkerComparator = (laneOrder) => {
  const order = Array.isArray(laneOrder) && laneOrder.length
    ? laneOrder
    : ['massive', 'heavy', 'light', 'ultraLight'];
  const rankByLane = new Map(order.map((laneName, index) => [laneName, index]));
  return (left, right) => {
    const leftEstimated = toNonNegativeNumberOrNull(left?.entry?.estimatedBytes);
    const rightEstimated = toNonNegativeNumberOrNull(right?.entry?.estimatedBytes);
    if (leftEstimated != null && rightEstimated != null && leftEstimated !== rightEstimated) {
      return rightEstimated - leftEstimated;
    }
    if (leftEstimated != null && rightEstimated == null) return -1;
    if (leftEstimated == null && rightEstimated != null) return 1;
    const leftPriority = Number.isFinite(Number(left?.entry?.priority))
      ? Number(left.entry.priority)
      : 0;
    const rightPriority = Number.isFinite(Number(right?.entry?.priority))
      ? Number(right.entry.priority)
      : 0;
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    const leftLaneRank = rankByLane.has(left?.laneName) ? rankByLane.get(left.laneName) : Number.MAX_SAFE_INTEGER;
    const rightLaneRank = rankByLane.has(right?.laneName) ? rankByLane.get(right.laneName) : Number.MAX_SAFE_INTEGER;
    if (leftLaneRank !== rightLaneRank) return leftLaneRank - rightLaneRank;
    const leftSeq = Number.isFinite(Number(left?.entry?.seq)) ? Number(left.entry.seq) : Number.MAX_SAFE_INTEGER;
    const rightSeq = Number.isFinite(Number(right?.entry?.seq)) ? Number(right.entry.seq) : Number.MAX_SAFE_INTEGER;
    if (leftSeq !== rightSeq) return leftSeq - rightSeq;
    const leftLabel = typeof left?.entry?.label === 'string' ? left.entry.label : '';
    const rightLabel = typeof right?.entry?.label === 'string' ? right.entry.label : '';
    return leftLabel.localeCompare(rightLabel);
  };
};

/**
 * Select a single pending write for the dedicated tail worker.
 *
 * Selection is deterministic: higher predicted write cost first, then priority,
 * then lane rank and enqueue sequence.
 *
 * @param {{ultraLight?:Array<object>,massive?:Array<object>,light?:Array<object>,heavy?:Array<object}} laneQueues
 * @param {{laneOrder?:Array<string>}} [options]
 * @returns {{laneName:string,entry:object}|null}
 */
const selectTailWorkerWriteEntry = (laneQueues, options = {}) => {
  const laneOrder = Array.isArray(options?.laneOrder) && options.laneOrder.length
    ? options.laneOrder
    : ['massive', 'heavy', 'light', 'ultraLight'];
  const compare = resolveTailWorkerComparator(laneOrder);
  let best = null;
  for (const laneName of laneOrder) {
    const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
    if (!queue || !queue.length) continue;
    for (let index = 0; index < queue.length; index += 1) {
      const candidate = { laneName, index, entry: queue[index] };
      if (!best || compare(candidate, best) < 0) {
        best = candidate;
      }
    }
  }
  if (!best) return null;
  const queue = laneQueues[best.laneName];
  const removed = queue.splice(best.index, 1);
  const entry = removed[0];
  if (!entry) return null;
  return {
    laneName: best.laneName,
    entry
  };
};

const isMicroCoalescibleWrite = (entry, maxEntryBytes) => {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.prefetched) return false;
  if (typeof entry.job !== 'function') return false;
  const estimatedBytes = toNonNegativeNumberOrNull(entry.estimatedBytes);
  if (estimatedBytes == null || estimatedBytes <= 0) return false;
  return estimatedBytes <= Math.max(1024, Math.floor(Number(maxEntryBytes) || 0));
};

/**
 * Select a deterministic micro-write batch from a queue head.
 *
 * @param {Array<object>} queue
 * @param {{maxEntries?:number,maxBytes?:number,maxEntryBytes?:number}} [options]
 * @returns {{entries:Array<object>,estimatedBytes:number}}
 */
const selectMicroWriteBatch = (queue, options = {}) => {
  const entries = [];
  if (!Array.isArray(queue) || !queue.length) {
    return { entries, estimatedBytes: 0 };
  }
  const maxEntries = Number.isFinite(Number(options?.maxEntries))
    ? Math.max(1, Math.floor(Number(options.maxEntries)))
    : 8;
  const maxBytes = Number.isFinite(Number(options?.maxBytes))
    ? Math.max(0, Math.floor(Number(options.maxBytes)))
    : (256 * 1024);
  const maxEntryBytes = Number.isFinite(Number(options?.maxEntryBytes))
    ? Math.max(1024, Math.floor(Number(options.maxEntryBytes)))
    : (64 * 1024);
  const first = queue.shift();
  if (!first) {
    return { entries, estimatedBytes: 0 };
  }
  const firstEstimatedBytes = toNonNegativeNumberOrNull(first.estimatedBytes) ?? 0;
  entries.push(first);
  if (
    maxEntries <= 1
    || maxBytes <= 0
    || !isMicroCoalescibleWrite(first, maxEntryBytes)
    || firstEstimatedBytes > maxBytes
  ) {
    return { entries, estimatedBytes: firstEstimatedBytes };
  }
  let totalEstimatedBytes = firstEstimatedBytes;
  while (queue.length > 0 && entries.length < maxEntries) {
    const candidate = queue[0];
    if (!isMicroCoalescibleWrite(candidate, maxEntryBytes)) break;
    const estimated = toNonNegativeNumberOrNull(candidate.estimatedBytes) ?? 0;
    if (estimated <= 0 || (totalEstimatedBytes + estimated) > maxBytes) break;
    entries.push(queue.shift());
    totalEstimatedBytes += estimated;
  }
  return { entries, estimatedBytes: totalEstimatedBytes };
};

/**
 * Compute a bounded adaptive shard count from payload size and throughput.
 *
 * @param {object} input
 * @param {number} input.estimatedBytes
 * @param {number} input.rowCount
 * @param {number|null} [input.throughputBytesPerSec]
 * @param {number} input.minShards
 * @param {number} input.maxShards
 * @param {number} input.defaultShards
 * @param {number} input.targetShardBytes
 * @param {number} [input.targetShardSeconds]
 * @returns {number}
 */
const resolveAdaptiveShardCount = ({
  estimatedBytes,
  rowCount,
  throughputBytesPerSec = null,
  minShards,
  maxShards,
  defaultShards,
  targetShardBytes,
  targetShardSeconds = 6
}) => {
  const totalBytes = Math.max(0, Math.floor(Number(estimatedBytes) || 0));
  const rows = Math.max(0, Math.floor(Number(rowCount) || 0));
  const min = Math.max(1, Math.floor(Number(minShards) || 1));
  const max = Math.max(min, Math.floor(Number(maxShards) || min));
  const fallback = Math.max(min, Math.min(max, Math.floor(Number(defaultShards) || min)));
  if (totalBytes <= 0 || rows <= 0) return fallback;
  const byteTarget = resolveOptionalPositiveNumber(targetShardBytes, null)
    || Math.max(1024 * 1024, Math.ceil(totalBytes / fallback));
  const throughput = resolveOptionalPositiveNumber(throughputBytesPerSec, null);
  const throughputTarget = throughput
    ? Math.max(
      1024 * 1024,
      Math.floor(throughput * Math.max(1, Number(targetShardSeconds) || 1))
    )
    : null;
  const effectiveTarget = throughputTarget
    ? Math.min(byteTarget, throughputTarget)
    : byteTarget;
  let count = Math.ceil(totalBytes / Math.max(1, effectiveTarget));
  count = Math.max(count, Math.ceil(rows / 2000));
  return Math.max(min, Math.min(max, count));
};

/**
 * Write index artifacts and metrics.
 * @param {object} input
 */
export async function writeIndexArtifacts(input) {
  const {
    scheduler = null,
    outDir,
    buildRoot,
    mode,
    state,
    postings,
    postingsConfig,
    modelId,
    useStubEmbeddings,
    dictSummary,
    timing,
    root,
    userConfig,
    incrementalEnabled,
    fileCounts,
    perfProfile,
    indexState,
    graphRelations,
    stageCheckpoints,
    telemetry = null,
    riskInterproceduralEmitArtifacts = null,
    repoProvenance = null
  } = input;
  const orderingStage = indexState?.stage || 'stage2';
  const recordOrdering = async (artifact, ordering, rule) => {
    if (!buildRoot || !ordering?.orderingHash) return;
    await recordOrderingHash(buildRoot, {
      stage: orderingStage,
      mode,
      artifact,
      hash: ordering.orderingHash,
      rule,
      count: ordering.orderingCount
    });
  };
  const measureVocabOrdering = (vocab = []) => {
    if (!Array.isArray(vocab) || !vocab.length) {
      return { orderingHash: null, orderingCount: 0 };
    }
    const orderingHasher = createOrderingHasher();
    for (const entry of vocab) {
      orderingHasher.update(entry);
    }
    const result = orderingHasher.digest();
    return {
      orderingHash: result?.hash || null,
      orderingCount: result?.count || 0
    };
  };
  const indexingConfig = userConfig?.indexing || {};
  const profileId = normalizeIndexProfileId(indexState?.profile?.id || indexingConfig.profile);
  const vectorOnlyProfile = profileId === INDEX_PROFILE_VECTOR_ONLY;
  const sparseArtifactsEnabled = !vectorOnlyProfile;
  const documentExtractionEnabled = indexingConfig.documentExtraction?.enabled === true;
  const {
    resolvedTokenMode,
    tokenMaxFiles,
    tokenSampleSize
  } = resolveTokenMode({ indexingConfig, state, fileCounts, profileId });
  const {
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressionMinBytes,
    compressionMaxBytes,
    compressibleArtifacts,
    compressionOverrides
  } = resolveCompressionConfig(indexingConfig);
  const artifactConfig = indexingConfig.artifacts || {};
  const compressionTierConfig = (
    artifactConfig.compressionTiers && typeof artifactConfig.compressionTiers === 'object'
      ? artifactConfig.compressionTiers
      : {}
  );
  const compressionTiersEnabled = compressionTierConfig.enabled !== false;
  const compressionTierHotNoCompression = compressionTierConfig.hotNoCompression !== false;
  const compressionTierColdForceCompression = compressionTierConfig.coldForceCompression !== false;
  const normalizeTierArtifactList = (value) => (
    Array.isArray(value)
      ? value.filter((entry) => typeof entry === 'string' && entry.trim())
      : []
  );
  const defaultHotTierArtifacts = [
    'chunk_meta',
    'chunk_uid_map',
    'file_meta',
    'token_postings',
    'token_postings_packed',
    'token_postings_binary-columnar',
    'dense_vectors_uint8',
    'dense_vectors_doc_uint8',
    'dense_vectors_code_uint8',
    'dense_meta',
    'index_state',
    'pieces_manifest'
  ];
  const defaultColdTierArtifacts = [
    'repo_map',
    'risk_summaries',
    'risk_flows',
    'call_sites',
    'graph_relations',
    'graph_relations_meta',
    'determinism_report',
    'extraction_report',
    'vocab_order'
  ];
  const tierHotArtifacts = normalizeTierArtifactList(compressionTierConfig.hotArtifacts);
  const tierColdArtifacts = normalizeTierArtifactList(compressionTierConfig.coldArtifacts);
  const resolveArtifactTier = (artifactName) => resolveArtifactCompressionTier(artifactName, {
    hotArtifacts: tierHotArtifacts.length ? tierHotArtifacts : defaultHotTierArtifacts,
    coldArtifacts: tierColdArtifacts.length ? tierColdArtifacts : defaultColdTierArtifacts,
    defaultTier: 'warm'
  });
  const tieredCompressionOverrides = {
    ...(compressionOverrides && typeof compressionOverrides === 'object'
      ? compressionOverrides
      : {})
  };
  if (compressionTiersEnabled) {
    for (const artifactName of compressibleArtifacts) {
      if (Object.prototype.hasOwnProperty.call(tieredCompressionOverrides, artifactName)) continue;
      const tier = resolveArtifactTier(artifactName);
      if (tier === 'hot' && compressionTierHotNoCompression) {
        tieredCompressionOverrides[artifactName] = {
          enabled: false,
          mode: compressionMode,
          keepRaw: true
        };
        continue;
      }
      if (tier === 'cold' && compressionTierColdForceCompression && compressionEnabled && compressionMode) {
        tieredCompressionOverrides[artifactName] = {
          enabled: true,
          mode: compressionMode,
          keepRaw: compressionKeepRaw
        };
      }
    }
  }
  const resolveCompressionOverride = (base) => (
    tieredCompressionOverrides && Object.prototype.hasOwnProperty.call(tieredCompressionOverrides, base)
      ? tieredCompressionOverrides[base]
      : null
  );
  const resolveShardCompression = (base) => {
    const override = resolveCompressionOverride(base);
    if (override) {
      return override.enabled ? override.mode : null;
    }
    return compressionEnabled && !compressionKeepRaw && compressibleArtifacts.has(base)
      ? compressionMode
      : null;
  };
  const writeFsStrategy = resolveArtifactWriteFsStrategy({ artifactConfig });
  const writeJsonlShapeAware = artifactConfig.writeJsonlShapeAware !== false;
  const writeJsonlLargeThresholdBytes = Number.isFinite(Number(artifactConfig.writeJsonlLargeThresholdBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.writeJsonlLargeThresholdBytes)))
    : (32 * 1024 * 1024);
  const artifactMode = typeof artifactConfig.mode === 'string'
    ? artifactConfig.mode.toLowerCase()
    : 'auto';
  const jsonArraySerializeShardThresholdMs = Number.isFinite(Number(artifactConfig.jsonArraySerializeShardThresholdMs))
    ? Math.max(0, Math.floor(Number(artifactConfig.jsonArraySerializeShardThresholdMs)))
    : 10;
  const jsonArraySerializeShardMaxBytes = Number.isFinite(Number(artifactConfig.jsonArraySerializeShardMaxBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.jsonArraySerializeShardMaxBytes)))
    : (64 * 1024 * 1024);
  const fileMetaFormatConfig = typeof artifactConfig.fileMetaFormat === 'string'
    ? artifactConfig.fileMetaFormat.toLowerCase()
    : null;
  const chunkMetaFormatConfig = typeof artifactConfig.chunkMetaFormat === 'string'
    ? artifactConfig.chunkMetaFormat.toLowerCase()
    : null;
  const binaryColumnarEnabled = artifactConfig.binaryColumnar !== false;
  const chunkMetaBinaryColumnar = artifactConfig.chunkMetaBinaryColumnar === true
    || (binaryColumnarEnabled && artifactConfig.chunkMetaBinaryColumnar !== false);
  const tokenPostingsBinaryColumnar = artifactConfig.tokenPostingsBinaryColumnar === true
    || (binaryColumnarEnabled && artifactConfig.tokenPostingsBinaryColumnar !== false);
  const chunkMetaJsonlThreshold = Number.isFinite(Number(artifactConfig.chunkMetaJsonlThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.chunkMetaJsonlThreshold)))
    : 200000;
  const chunkMetaJsonlEstimateThresholdBytes = Number.isFinite(
    Number(artifactConfig.chunkMetaJsonlEstimateThresholdBytes)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.chunkMetaJsonlEstimateThresholdBytes)))
    : (1 * 1024 * 1024);
  const chunkMetaShardSizeRaw = Number(artifactConfig.chunkMetaShardSize);
  const chunkMetaShardSizeExplicit = Number.isFinite(chunkMetaShardSizeRaw);
  const chunkMetaShardSize = chunkMetaShardSizeExplicit
    ? Math.max(0, Math.floor(chunkMetaShardSizeRaw))
    : 100000;
  const indexerConfig = indexingConfig.indexer && typeof indexingConfig.indexer === 'object'
    ? indexingConfig.indexer
    : {};
  const chunkMetaStreaming = indexerConfig.streamingChunks !== false;
  const symbolArtifactsFormatConfig = typeof artifactConfig.symbolArtifactsFormat === 'string'
    ? artifactConfig.symbolArtifactsFormat.toLowerCase()
    : null;
  const tokenPostingsFormatConfig = typeof artifactConfig.tokenPostingsFormat === 'string'
    ? artifactConfig.tokenPostingsFormat.toLowerCase()
    : null;
  const tokenPostingsPackedAutoThresholdBytes = Number.isFinite(
    Number(artifactConfig.tokenPostingsPackedAutoThresholdBytes)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsPackedAutoThresholdBytes)))
    : (1 * 1024 * 1024);
  let tokenPostingsShardSize = Number.isFinite(Number(artifactConfig.tokenPostingsShardSize))
    ? Math.max(1000, Math.floor(Number(artifactConfig.tokenPostingsShardSize)))
    : 50000;
  const tokenPostingsShardThreshold = Number.isFinite(Number(artifactConfig.tokenPostingsShardThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.tokenPostingsShardThreshold)))
    : 200000;
  const fieldTokensShardThresholdBytes = Number.isFinite(Number(artifactConfig.fieldTokensShardThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldTokensShardThresholdBytes)))
    : (8 * 1024 * 1024);
  const fieldTokensShardMaxBytes = Number.isFinite(Number(artifactConfig.fieldTokensShardMaxBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldTokensShardMaxBytes)))
    : (8 * 1024 * 1024);
  const artifactWriteThroughputBytesPerSec = resolveArtifactWriteThroughputProfile(perfProfile);
  const fieldPostingsShardsEnabled = artifactConfig.fieldPostingsShards === true;
  const fieldPostingsShardThresholdBytes = Number.isFinite(Number(artifactConfig.fieldPostingsShardThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldPostingsShardThresholdBytes)))
    : (64 * 1024 * 1024);
  const fieldPostingsShardCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.fieldPostingsShardCount)))
    : 8;
  const fieldPostingsShardMinCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardMinCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.fieldPostingsShardMinCount)))
    : 8;
  const fieldPostingsShardMaxCount = Number.isFinite(Number(artifactConfig.fieldPostingsShardMaxCount))
    ? Math.max(fieldPostingsShardMinCount, Math.floor(Number(artifactConfig.fieldPostingsShardMaxCount)))
    : 16;
  const fieldPostingsShardTargetBytes = Number.isFinite(Number(artifactConfig.fieldPostingsShardTargetBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.fieldPostingsShardTargetBytes)))
    : (32 * 1024 * 1024);
  const fieldPostingsShardTargetSeconds = Number.isFinite(Number(artifactConfig.fieldPostingsShardTargetSeconds))
    ? Math.max(1, Number(artifactConfig.fieldPostingsShardTargetSeconds))
    : 6;
  const fieldPostingsBinaryColumnar = artifactConfig.fieldPostingsBinaryColumnar === true;
  const fieldPostingsBinaryColumnarThresholdBytes = Number.isFinite(
    Number(artifactConfig.fieldPostingsBinaryColumnarThresholdBytes)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.fieldPostingsBinaryColumnarThresholdBytes)))
    : (96 * 1024 * 1024);
  const fieldPostingsKeepLegacyJson = artifactConfig.fieldPostingsKeepLegacyJson !== false;
  const chunkMetaAdaptiveShardsEnabled = artifactConfig.chunkMetaAdaptiveShards !== false;
  const chunkMetaShardMinCount = Number.isFinite(Number(artifactConfig.chunkMetaShardMinCount))
    ? Math.max(2, Math.floor(Number(artifactConfig.chunkMetaShardMinCount)))
    : 4;
  const chunkMetaShardMaxCount = Number.isFinite(Number(artifactConfig.chunkMetaShardMaxCount))
    ? Math.max(chunkMetaShardMinCount, Math.floor(Number(artifactConfig.chunkMetaShardMaxCount)))
    : 32;
  const chunkMetaShardTargetBytes = Number.isFinite(Number(artifactConfig.chunkMetaShardTargetBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.chunkMetaShardTargetBytes)))
    : (16 * 1024 * 1024);
  const chunkMetaShardTargetSeconds = Number.isFinite(Number(artifactConfig.chunkMetaShardTargetSeconds))
    ? Math.max(1, Number(artifactConfig.chunkMetaShardTargetSeconds))
    : 6;
  const minhashJsonLargeThreshold = Number.isFinite(Number(artifactConfig.minhashJsonLargeThreshold))
    ? Math.max(0, Math.floor(Number(artifactConfig.minhashJsonLargeThreshold)))
    : 5000;
  const writeProgressHeartbeatMs = Number.isFinite(Number(artifactConfig.writeProgressHeartbeatMs))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeProgressHeartbeatMs)))
    : 15000;

  const maxJsonBytes = MAX_JSON_BYTES;
  const byteBudgetState = resolveByteBudgetMap({ indexingConfig, maxJsonBytes });
  const byteBudgetPolicies = byteBudgetState.policies || {};
  const resolveBudget = (name) => byteBudgetPolicies?.[name] || null;
  const resolveBudgetMaxBytes = (name, fallback) => {
    const budget = resolveBudget(name);
    return Number.isFinite(budget?.maxBytes) ? budget.maxBytes : fallback;
  };
  const byteBudgetSnapshot = {
    generatedAt: new Date().toISOString(),
    maxJsonBytes,
    strict: !!byteBudgetState.strict,
    policies: byteBudgetPolicies
  };
  if (buildRoot) {
    await updateBuildState(buildRoot, { byteBudgets: byteBudgetSnapshot });
  }
  const maxJsonBytesSoft = maxJsonBytes * 0.9;
  const shardTargetBytes = maxJsonBytes * 0.75;
  const fileMetaBudget = resolveBudget('file_meta');
  const chunkMetaBudget = resolveBudget('chunk_meta');
  const tokenPostingsBudget = resolveBudget('token_postings');
  const repoMapBudget = resolveBudget('repo_map');
  const fileRelationsBudget = resolveBudget('file_relations');
  const vfsBudget = resolveBudget('vfs_manifest');
  const symbolEdgesBudget = resolveBudget('symbol_edges');
  const symbolOccurrencesBudget = resolveBudget('symbol_occurrences');
  const callSitesBudget = resolveBudget('call_sites');
  const chunkUidMapBudget = resolveBudget('chunk_uid_map');
  const graphRelationsBudget = resolveBudget('graph_relations');
  const fileMetaMaxBytes = resolveBudgetMaxBytes('file_meta', maxJsonBytes);
  const chunkMetaMaxBytes = resolveBudgetMaxBytes('chunk_meta', maxJsonBytes);
  const tokenPostingsMaxBytes = resolveBudgetMaxBytes('token_postings', maxJsonBytes);
  const repoMapMaxBytes = resolveBudgetMaxBytes('repo_map', maxJsonBytes);
  const fileRelationsMaxBytes = resolveBudgetMaxBytes('file_relations', maxJsonBytes);
  const vfsMaxBytes = resolveBudgetMaxBytes('vfs_manifest', maxJsonBytes);
  const symbolEdgesMaxBytes = resolveBudgetMaxBytes('symbol_edges', maxJsonBytes);
  const symbolOccurrencesMaxBytes = resolveBudgetMaxBytes('symbol_occurrences', maxJsonBytes);
  const callSitesMaxBytes = resolveBudgetMaxBytes('call_sites', maxJsonBytes);
  const chunkUidMapMaxBytes = resolveBudgetMaxBytes('chunk_uid_map', maxJsonBytes);
  const graphRelationsMaxBytes = resolveBudgetMaxBytes('graph_relations', maxJsonBytes);
  const tokenPostingsMaxBytesSoft = Number.isFinite(tokenPostingsMaxBytes) ? tokenPostingsMaxBytes * 0.9 : maxJsonBytesSoft;
  const tokenPostingsShardTargetBytes = Number.isFinite(tokenPostingsMaxBytes)
    ? tokenPostingsMaxBytes * 0.75
    : shardTargetBytes;
  const fileMetaColumnarThreshold = Number.isFinite(Number(artifactConfig.fileMetaColumnarThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaColumnarThresholdBytes)))
    : fileMetaMaxBytes;
  const fileMetaJsonlThreshold = Number.isFinite(Number(artifactConfig.fileMetaJsonlThresholdBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaJsonlThresholdBytes)))
    : Math.min(fileMetaMaxBytes, 1 * 1024 * 1024);
  const fileMetaShardedMaxBytes = Number.isFinite(Number(artifactConfig.fileMetaShardedMaxBytes))
    ? Math.max(0, Math.floor(Number(artifactConfig.fileMetaShardedMaxBytes)))
    : Math.min(fileMetaMaxBytes, 8 * 1024 * 1024);
  const toolingConfig = getToolingConfig(root, userConfig);
  const vfsHashRouting = toolingConfig?.vfs?.hashRouting === true;
  // Keep file_meta fingerprint source deterministic: prefer discovery order when
  // available, otherwise fall back to sorted fileInfo keys.
  const resolveFileMetaFiles = () => {
    if (Array.isArray(state?.discoveredFiles) && state.discoveredFiles.length) {
      return state.discoveredFiles.slice();
    }
    if (state?.fileInfoByPath && typeof state.fileInfoByPath.keys === 'function') {
      return Array.from(state.fileInfoByPath.keys()).sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
    }
    return [];
  };
  const fileMetaFiles = resolveFileMetaFiles();
  let fileMetaFingerprint = fileMetaFiles.length
    ? computeFileMetaFingerprint({ files: fileMetaFiles, fileInfoByPath: state?.fileInfoByPath })
    : null;
  const fileMetaCacheFlags = [
    `format:${fileMetaFormatConfig || 'auto'}`,
    `columnarThreshold:${fileMetaColumnarThreshold}`,
    `jsonlThreshold:${fileMetaJsonlThreshold}`
  ];
  const fileMetaCacheKey = fileMetaFingerprint
    ? buildCacheKey({
      repoHash: indexState?.repoId || null,
      buildConfigHash: fileMetaFingerprint,
      mode,
      schemaVersion: 'file-meta-cache-v1',
      featureFlags: fileMetaCacheFlags,
      pathPolicy: 'posix'
    }).key
    : null;
  let fileMeta = null;
  let fileIdByPath = new Map();
  let fileMetaFromCache = false;
  let fileMetaMeta = null;
  if (incrementalEnabled && fileMetaFingerprint) {
    const metaPath = path.join(outDir, 'file_meta.meta.json');
    try {
      if (fsSync.existsSync(metaPath)) {
        const metaRaw = readJsonFile(metaPath, { maxBytes: fileMetaMaxBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        const cachedFingerprint = meta?.fingerprint ?? meta?.extensions?.fingerprint ?? null;
        const cachedCacheKey = meta?.cacheKey ?? meta?.extensions?.cacheKey ?? null;
        const cacheKeyMatches = !!(cachedCacheKey && fileMetaCacheKey && cachedCacheKey === fileMetaCacheKey);
        const fingerprintMatches = !!(cachedFingerprint && fileMetaFingerprint && cachedFingerprint === fileMetaFingerprint);
        if (cacheKeyMatches || (!cachedCacheKey && fingerprintMatches)) {
          fileMetaMeta = meta;
          const cached = await loadJsonArrayArtifact(outDir, 'file_meta', {
            maxBytes: fileMetaMaxBytes,
            strict: false
          });
          if (Array.isArray(cached)) {
            fileMeta = cached;
            fileMetaFromCache = true;
            for (const entry of cached) {
              if (entry?.file && Number.isFinite(entry.id)) {
                fileIdByPath.set(entry.file, entry.id);
              }
            }
          }
        }
      }
    } catch {}
  }
  if (!fileMeta) {
    const built = buildFileMeta(state);
    fileMeta = built.fileMeta;
    fileIdByPath = built.fileIdByPath;
    fileMetaFingerprint = built.fingerprint || fileMetaFingerprint;
  }
  if (indexState && typeof indexState === 'object') {
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    if (state?.discoveryHash) {
      indexState.extensions.discoveryHash = state.discoveryHash;
    }
    if (fileMetaFingerprint) {
      indexState.extensions.fileMetaFingerprint = fileMetaFingerprint;
    }
    if (postings?.minhashGuard) {
      indexState.extensions.minhashGuard = postings.minhashGuard;
    }
  }
  const chunkUidToFileId = new Map();
  if (state?.chunkUidToFile && typeof state.chunkUidToFile.entries === 'function') {
    for (const [chunkUid, file] of state.chunkUidToFile.entries()) {
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  } else {
    for (const chunk of state?.chunks || []) {
      const file = chunk?.file || chunk?.metaV2?.file || null;
      const chunkUid = chunk?.chunkUid || chunk?.metaV2?.chunkUid || null;
      if (!file || !chunkUid) continue;
      const fileId = fileIdByPath.get(file);
      if (!Number.isFinite(fileId)) continue;
      if (!chunkUidToFileId.has(chunkUid)) {
        chunkUidToFileId.set(chunkUid, fileId);
      }
    }
  }
  const repoMapIterator = createRepoMapIterator({
    chunks: state.chunks,
    fileRelations: state.fileRelations
  });

  const { fileListPath } = await writeFileLists({
    outDir,
    state,
    userConfig,
    log
  });


  const resolvedConfig = normalizePostingsConfig(postingsConfig || {});
  const resolveExistingOrBakPath = (targetPath) => {
    if (!targetPath) return null;
    if (fsSync.existsSync(targetPath)) return targetPath;
    const bakPath = `${targetPath}.bak`;
    if (fsSync.existsSync(bakPath)) return bakPath;
    return null;
  };
  let previousFilterIndexResolved = false;
  let previousFilterIndex = null;
  /**
   * Resolve the previous filter-index artifact (or its `.bak` fallback) once
   * so retry/fallback paths can reuse a validated prior output.
   *
   * @returns {{piece:object|null,source:string|null}}
   */
  const resolvePreviousFilterIndex = () => {
    if (previousFilterIndexResolved) return previousFilterIndex;
    previousFilterIndexResolved = true;
    const previousPiecesManifestPath = path.join(outDir, 'pieces', 'manifest.json');
    let previousPiecesManifest = null;
    try {
      const source = resolveExistingOrBakPath(previousPiecesManifestPath);
      if (source) {
        previousPiecesManifest = readJsonFile(source, { maxBytes: maxJsonBytes });
      }
    } catch {}
    const previousPieces = Array.isArray(previousPiecesManifest?.pieces) ? previousPiecesManifest.pieces : [];
    const previousFilterIndexPiece = previousPieces.find((piece) => piece?.name === 'filter_index' && piece?.path);
    const previousFilterIndexPath = previousFilterIndexPiece?.path
      ? path.join(outDir, ...String(previousFilterIndexPiece.path).split('/'))
      : null;
    const previousFilterIndexSource = resolveExistingOrBakPath(previousFilterIndexPath);
    previousFilterIndex = {
      piece: previousFilterIndexPiece,
      source: previousFilterIndexSource
    };
    return previousFilterIndex;
  };
  let filterIndex = null;
  let filterIndexStats = null;
  let filterIndexReused = false;
  let filterIndexFallback = null;
  const reusePreviousFilterIndex = (reason) => {
    const previous = resolvePreviousFilterIndex();
    const previousFilterIndexSource = previous?.source || null;
    const previousFilterIndexPiece = previous?.piece || null;
    if (!previousFilterIndexSource) return false;
    const note = reason ? ` (${reason})` : '';
    log(`[warn] [filter_index] build skipped; reusing previous artifact.${note}`);
    let previousRaw = null;
    try {
      previousRaw = readJsonFile(previousFilterIndexSource, { maxBytes: maxJsonBytes });
      validateSerializedFilterIndex(previousRaw);
    } catch (err) {
      const message = err?.message || String(err);
      log(`[warn] [filter_index] failed to reuse previous artifact; validation failed. (${message})`);
      return false;
    }
    filterIndexReused = true;
    filterIndexFallback = {
      piece: {
        type: previousFilterIndexPiece?.type || 'chunks',
        name: 'filter_index',
        format: previousFilterIndexPiece?.format || 'json'
      },
      path: previousFilterIndexSource
    };
    try {
      filterIndexStats = summarizeFilterIndex(previousRaw);
    } catch {
      filterIndexStats = { reused: true };
    }
    if (filterIndexStats && typeof filterIndexStats === 'object') {
      filterIndexStats.reused = true;
    }
    return true;
  };
  const validateSerializedFilterIndex = (candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('expected object');
    }
    if (!Number.isFinite(Number(candidate.schemaVersion))) {
      throw new Error('missing schemaVersion');
    }
    if (!Number.isFinite(Number(candidate.fileChargramN))) {
      throw new Error('missing fileChargramN');
    }
    if (!Array.isArray(candidate.fileById)) {
      throw new Error('missing fileById');
    }
    if (!Array.isArray(candidate.fileChunksById)) {
      throw new Error('missing fileChunksById');
    }
    if (candidate.fileById.length !== candidate.fileChunksById.length) {
      throw new Error('fileById/fileChunksById length mismatch');
    }
    if (candidate.byLang == null || typeof candidate.byLang !== 'object') {
      throw new Error('missing byLang');
    }
    return true;
  };
  try {
    filterIndex = buildSerializedFilterIndex({
      chunks: state.chunks,
      resolvedConfig,
      userConfig,
      root
    });
    validateSerializedFilterIndex(filterIndex);
    filterIndexStats = summarizeFilterIndex(filterIndex);
    if (filterIndexStats && typeof filterIndexStats === 'object' && Number.isFinite(filterIndexStats.jsonBytes)) {
      // filter_index is currently written uncompressed (compressible=false); keep a stable estimate
      // in case later phases make it compressible.
      filterIndexStats.diskBytesEstimate = filterIndexStats.jsonBytes;
      filterIndexStats.compressionRatioEstimate = 1;
    }
    if (filterIndexStats?.jsonBytes && filterIndexStats.jsonBytes > maxJsonBytesSoft) {
      log(
        `filter_index ~${formatBytes(filterIndexStats.jsonBytes)}; ` +
        'large filter indexes increase memory usage (consider sqlite for large repos).'
      );
    }
  } catch (err) {
    const message = err?.message || String(err);
    log(`[warn] [filter_index] build failed; skipping. (${message})`);
    filterIndex = null;
    filterIndexStats = null;
    reusePreviousFilterIndex(message);
  }
  if (indexState && typeof indexState === 'object') {
    const filterIndexState = indexState.filterIndex && typeof indexState.filterIndex === 'object'
      && !Array.isArray(indexState.filterIndex)
      ? indexState.filterIndex
      : {};
    filterIndexState.ready = Boolean(filterIndex) || filterIndexReused;
    filterIndexState.reused = Boolean(filterIndexStats?.reused);
    filterIndexState.stats = filterIndexStats || null;
    indexState.filterIndex = filterIndexState;
  }
  const denseScale = 2 / 255;
  const chunkMetaHasIds = Array.isArray(state.chunks)
    && state.chunks.length > 0
    && state.chunks.every((chunk) => Number.isFinite(chunk?.id));
  const chunkMetaOrder = chunkMetaHasIds
    ? resolveChunkMetaOrderById(state.chunks)
    : resolveChunkMetaOrder(state.chunks);
  const chunkMetaIterator = createChunkMetaIterator({
    chunks: state.chunks,
    fileIdByPath,
    resolvedTokenMode,
    tokenSampleSize,
    maxJsonBytes: chunkMetaMaxBytes,
    order: chunkMetaOrder
  });
  const chunkMetaPlan = resolveChunkMetaPlan({
    chunks: state.chunks,
    chunkMetaIterator,
    artifactMode,
    chunkMetaFormatConfig,
    chunkMetaStreaming,
    chunkMetaBinaryColumnar,
    chunkMetaJsonlThreshold,
    chunkMetaJsonlEstimateThresholdBytes,
    chunkMetaShardSize,
    maxJsonBytes: chunkMetaMaxBytes
  });
  if (
    chunkMetaAdaptiveShardsEnabled
    && !chunkMetaShardSizeExplicit
    && chunkMetaPlan.chunkMetaUseJsonl
    && chunkMetaPlan.chunkMetaCount > 0
  ) {
    const chunkMetaEstimatedBytes = Number.isFinite(chunkMetaPlan.chunkMetaEstimatedJsonlBytes)
      && chunkMetaPlan.chunkMetaEstimatedJsonlBytes > 0
      ? chunkMetaPlan.chunkMetaEstimatedJsonlBytes
      : Math.max(chunkMetaPlan.chunkMetaCount * 256, chunkMetaPlan.chunkMetaCount);
    const adaptiveChunkMetaShardCount = resolveAdaptiveShardCount({
      estimatedBytes: chunkMetaEstimatedBytes,
      rowCount: chunkMetaPlan.chunkMetaCount,
      throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
      minShards: chunkMetaShardMinCount,
      maxShards: chunkMetaShardMaxCount,
      defaultShards: Math.max(1, Math.ceil(chunkMetaPlan.chunkMetaCount / Math.max(1, chunkMetaPlan.chunkMetaShardSize))),
      targetShardBytes: chunkMetaShardTargetBytes,
      targetShardSeconds: chunkMetaShardTargetSeconds
    });
    const adaptiveChunkMetaShardSize = Math.max(
      1,
      Math.ceil(chunkMetaPlan.chunkMetaCount / adaptiveChunkMetaShardCount)
    );
    chunkMetaPlan.chunkMetaShardSize = adaptiveChunkMetaShardSize;
    chunkMetaPlan.chunkMetaUseShards = chunkMetaPlan.chunkMetaCount > adaptiveChunkMetaShardSize;
    if (typeof log === 'function') {
      log(
        `[chunk_meta] adaptive shard plan: ${adaptiveChunkMetaShardCount} shards ` +
        `(rows=${chunkMetaPlan.chunkMetaCount.toLocaleString()}, target=${formatBytes(chunkMetaShardTargetBytes)}, ` +
        `throughput=${artifactWriteThroughputBytesPerSec ? `${formatBytes(artifactWriteThroughputBytesPerSec)}/s` : 'n/a'}).`
      );
    }
  }
  const {
    tokenPostingsFormat,
    tokenPostingsUseShards,
    tokenPostingsShardSize: resolvedTokenPostingsShardSize,
    tokenPostingsEstimate
  } = resolveTokenPostingsPlan({
    artifactMode,
    tokenPostingsFormatConfig,
    tokenPostingsShardSize,
    tokenPostingsShardThreshold,
    tokenPostingsBinaryColumnar,
    tokenPostingsPackedAutoThresholdBytes,
    postings,
    maxJsonBytes: tokenPostingsMaxBytes,
    maxJsonBytesSoft: tokenPostingsMaxBytesSoft,
    shardTargetBytes: tokenPostingsShardTargetBytes,
    log
  });
  if (sparseArtifactsEnabled && tokenPostingsEstimate?.estimatedBytes) {
    applyByteBudget({
      budget: tokenPostingsBudget,
      totalBytes: tokenPostingsEstimate.estimatedBytes,
      label: 'token_postings',
      stageCheckpoints,
      logger: log
    });
  }
  tokenPostingsShardSize = resolvedTokenPostingsShardSize;
  if (sparseArtifactsEnabled) {
    await ensureDiskSpace({
      targetPath: outDir,
      requiredBytes: tokenPostingsEstimate?.estimatedBytes,
      label: `${mode} token_postings`
    });
  }
  const cleanupActions = [];
  const recordCleanupAction = ({ targetPath, recursive = false, policy = 'legacy' }) => {
    if (!targetPath) return;
    cleanupActions.push({
      path: toPosix(path.relative(outDir, targetPath)),
      recursive: recursive === true,
      policy
    });
  };
  const removeArtifact = async (targetPath, options = {}) => {
    const { recursive = true, policy = 'legacy' } = options;
    try {
      if (fsSync.existsSync(targetPath)) {
        logLine(`[artifact-cleanup] remove ${targetPath}`, { kind: 'status' });
        recordCleanupAction({ targetPath, recursive, policy });
      }
      await fs.rm(targetPath, { recursive, force: true });
    } catch {}
  };
  if (vectorOnlyProfile) {
    await cleanupVectorOnlySparseArtifacts({ outDir, removeArtifact });
  } else {
    if (tokenPostingsFormat === 'packed') {
      await Promise.all([
        removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await removePackedPostings({ outDir, removeArtifact });
    }
    if (tokenPostingsUseShards) {
      await Promise.all([
        removeArtifact(path.join(outDir, 'token_postings.json'), { policy: 'format_cleanup' }),
        removeCompressedArtifact({ outDir, base: 'token_postings', removeArtifact }),
        removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    } else {
      await Promise.all([
        removeArtifact(path.join(outDir, 'token_postings.meta.json'), { policy: 'format_cleanup' }),
        removeArtifact(path.join(outDir, 'token_postings.shards'), {
          recursive: true,
          policy: 'format_cleanup'
        })
      ]);
    }
  }
  if (indexState && typeof indexState === 'object') {
    if (!indexState.extensions || typeof indexState.extensions !== 'object') {
      indexState.extensions = {};
    }
    indexState.extensions.artifactCleanup = {
      schemaVersion: 1,
      profileId,
      allowlistOnly: vectorOnlyProfile,
      actions: cleanupActions
    };
  }
  const writeStart = Date.now();
  const writes = [];
  let totalWrites = 0;
  let completedWrites = 0;
  let lastWriteLog = 0;
  let lastWriteLabel = '';
  const activeWrites = new Map();
  const activeWriteBytes = new Map();
  let writeHeartbeatTimer = null;
  const artifactMetrics = new Map();
  const artifactQueueDelaySamples = new Map();
  const writeLogIntervalMs = 1000;
  const writeProgressMeta = { stage: 'write', mode, taskId: `write:${mode}:artifacts` };
  const configuredWriteStallThresholds = Array.isArray(artifactConfig.writeStallThresholdsSeconds)
    ? artifactConfig.writeStallThresholdsSeconds
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry) && entry > 0)
      .map((entry) => Math.floor(entry))
      .sort((a, b) => a - b)
    : [];
  const legacyWarnThreshold = Number.isFinite(Number(artifactConfig.writeStallWarnSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeStallWarnSeconds)))
    : null;
  const legacyCriticalThreshold = Number.isFinite(Number(artifactConfig.writeStallCriticalSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeStallCriticalSeconds)))
    : null;
  const writeStallThresholdsSeconds = Array.from(new Set(
    configuredWriteStallThresholds.length
      ? configuredWriteStallThresholds
      : [10, 30, 60]
  ));
  if (!configuredWriteStallThresholds.length && legacyWarnThreshold != null) {
    writeStallThresholdsSeconds.push(legacyWarnThreshold);
  }
  if (!configuredWriteStallThresholds.length && legacyCriticalThreshold != null) {
    writeStallThresholdsSeconds.push(legacyCriticalThreshold);
  }
  const normalizedWriteStallThresholds = Array.from(new Set(writeStallThresholdsSeconds)).sort((a, b) => a - b);
  const stallThresholdLevelName = (thresholdSec, index) => {
    if (thresholdSec >= 60) return 'severe';
    if (thresholdSec >= 30) return 'critical';
    if (thresholdSec >= 10) return 'warning';
    return `level-${index + 1}`;
  };
  const heavyWriteThresholdBytes = Number.isFinite(Number(artifactConfig.writeHeavyThresholdBytes))
    ? Math.max(1024 * 1024, Math.floor(Number(artifactConfig.writeHeavyThresholdBytes)))
    : (16 * 1024 * 1024);
  const forcedHeavyWritePatterns = Array.isArray(artifactConfig.writeHeavyLabelPatterns)
    ? artifactConfig.writeHeavyLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)field_postings(?:\.|$)/,
      /(^|\/)token_postings(?:\.|$)/,
      /(^|\/)chunk_meta(?:\.|$)/
    ];
  const heavyWriteConcurrencyOverride = Number.isFinite(Number(artifactConfig.writeHeavyConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeHeavyConcurrency)))
    : null;
  const ultraLightWriteThresholdBytes = Number.isFinite(Number(artifactConfig.writeUltraLightThresholdBytes))
    ? Math.max(1024, Math.floor(Number(artifactConfig.writeUltraLightThresholdBytes)))
    : (64 * 1024);
  const forcedUltraLightWritePatterns = Array.isArray(artifactConfig.writeUltraLightLabelPatterns)
    ? artifactConfig.writeUltraLightLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)\.filelists\.json$/,
      /(^|\/).*\.meta\.json$/,
      /(^|\/)determinism_report\.json$/,
      /(^|\/)vocab_order\.json$/,
      /(^|\/)pieces\/manifest\.json$/
    ];
  const massiveWriteThresholdBytes = Number.isFinite(Number(artifactConfig.writeMassiveThresholdBytes))
    ? Math.max(8 * 1024 * 1024, Math.floor(Number(artifactConfig.writeMassiveThresholdBytes)))
    : (128 * 1024 * 1024);
  const forcedMassiveWritePatterns = Array.isArray(artifactConfig.writeMassiveLabelPatterns)
    ? artifactConfig.writeMassiveLabelPatterns
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => new RegExp(entry))
    : [
      /(^|\/)field_postings(?:\.|$)/,
      /(^|\/)field_postings\.binary-columnar(?:\.|$)/,
      /(^|\/)token_postings\.packed(?:\.|$)/,
      /(^|\/)token_postings\.binary-columnar(?:\.|$)/,
      /(^|\/)chunk_meta\.binary-columnar(?:\.|$)/
    ];
  const massiveWriteIoTokens = Number.isFinite(Number(artifactConfig.writeMassiveIoTokens))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeMassiveIoTokens)))
    : 2;
  const massiveWriteMemTokens = Number.isFinite(Number(artifactConfig.writeMassiveMemTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeMassiveMemTokens)))
    : 2;
  const resolveWorkClassOverride = (...values) => {
    for (const candidate of values) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.max(1, Math.floor(parsed));
      }
    }
    return null;
  };
  const workClassSmallConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeSmallConcurrency,
    artifactConfig.writeWorkClassSmallConcurrency
  );
  const workClassMediumConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeMediumConcurrency,
    artifactConfig.writeWorkClassMediumConcurrency,
    artifactConfig.writeHeavyConcurrency
  );
  const workClassLargeConcurrencyOverride = resolveWorkClassOverride(
    artifactConfig.writeLargeConcurrency,
    artifactConfig.writeWorkClassLargeConcurrency,
    artifactConfig.writeMassiveConcurrency
  );
  const adaptiveWriteConcurrencyEnabled = artifactConfig.writeAdaptiveConcurrency !== false;
  const adaptiveWriteMinConcurrency = Number.isFinite(Number(artifactConfig.writeAdaptiveMinConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveMinConcurrency)))
    : 1;
  const adaptiveWriteStartConcurrencyOverride = Number.isFinite(Number(artifactConfig.writeAdaptiveStartConcurrency))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStartConcurrency)))
    : null;
  const adaptiveWriteScaleUpBacklogPerSlot = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleUpBacklogPerSlot)
  )
    ? Math.max(1, Number(artifactConfig.writeAdaptiveScaleUpBacklogPerSlot))
    : 1.75;
  const adaptiveWriteScaleDownBacklogPerSlot = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleDownBacklogPerSlot)
  )
    ? Math.max(0, Number(artifactConfig.writeAdaptiveScaleDownBacklogPerSlot))
    : 0.5;
  const adaptiveWriteStallScaleDownSeconds = Number.isFinite(
    Number(artifactConfig.writeAdaptiveStallScaleDownSeconds)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStallScaleDownSeconds)))
    : 20;
  const adaptiveWriteStallScaleUpGuardSeconds = Number.isFinite(
    Number(artifactConfig.writeAdaptiveStallScaleUpGuardSeconds)
  )
    ? Math.max(1, Math.floor(Number(artifactConfig.writeAdaptiveStallScaleUpGuardSeconds)))
    : 8;
  const adaptiveWriteScaleUpCooldownMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleUpCooldownMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveScaleUpCooldownMs)))
    : 400;
  const adaptiveWriteScaleDownCooldownMs = Number.isFinite(
    Number(artifactConfig.writeAdaptiveScaleDownCooldownMs)
  )
    ? Math.max(0, Math.floor(Number(artifactConfig.writeAdaptiveScaleDownCooldownMs)))
    : 1200;
  const writeTailRescueEnabled = artifactConfig.writeTailRescue !== false;
  const writeTailRescueMaxPending = Number.isFinite(Number(artifactConfig.writeTailRescueMaxPending))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailRescueMaxPending)))
    : 3;
  const writeTailRescueStallSeconds = Number.isFinite(Number(artifactConfig.writeTailRescueStallSeconds))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailRescueStallSeconds)))
    : 15;
  const writeTailRescueBoostIoTokens = Number.isFinite(Number(artifactConfig.writeTailRescueBoostIoTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeTailRescueBoostIoTokens)))
    : 1;
  const writeTailRescueBoostMemTokens = Number.isFinite(Number(artifactConfig.writeTailRescueBoostMemTokens))
    ? Math.max(0, Math.floor(Number(artifactConfig.writeTailRescueBoostMemTokens)))
    : 1;
  const writeTailWorkerEnabled = writeFsStrategy.tailWorker;
  const writeTailWorkerMaxPending = Number.isFinite(Number(artifactConfig.writeTailWorkerMaxPending))
    ? Math.max(1, Math.floor(Number(artifactConfig.writeTailWorkerMaxPending)))
    : Math.max(2, writeTailRescueMaxPending + 1);
  const writeStallAlerts = new Map();
  const updateWriteInFlightTelemetry = () => {
    if (!telemetry || typeof telemetry.setInFlightBytes !== 'function') return;
    let bytes = 0;
    for (const value of activeWriteBytes.values()) {
      if (Number.isFinite(value) && value > 0) bytes += value;
    }
    telemetry.setInFlightBytes('artifacts.write', {
      bytes,
      count: activeWrites.size
    });
  };
  const getLongestWriteStallSeconds = () => {
    if (!activeWrites.size) return 0;
    const now = Date.now();
    let longest = 0;
    for (const startedAt of activeWrites.values()) {
      const elapsed = Math.max(0, now - (Number(startedAt) || now));
      if (elapsed > longest) longest = elapsed;
    }
    return Math.max(0, Math.round(longest / 1000));
  };
  let enqueueSeq = 0;
  const formatArtifactLabel = (filePath) => toPosix(path.relative(outDir, filePath));
  const pieceEntries = [];
  const pieceEntriesByPath = new Map();
  let mmapHotLayoutOrder = 0;
  const resolvePieceTier = (entry, normalizedPath) => {
    const explicitTier = typeof entry?.tier === 'string' ? entry.tier.trim().toLowerCase() : null;
    if (explicitTier === 'hot' || explicitTier === 'warm' || explicitTier === 'cold') {
      return explicitTier;
    }
    const candidateName = typeof entry?.name === 'string' && entry.name
      ? entry.name
      : normalizedPath;
    return resolveArtifactTier(candidateName);
  };
  const addPieceFile = (entry, filePath) => {
    const normalizedPath = formatArtifactLabel(filePath);
    const tier = resolvePieceTier(entry, normalizedPath);
    const existingLayout = entry?.layout && typeof entry.layout === 'object'
      ? { ...entry.layout }
      : {};
    if (tier === 'hot') {
      if (!Number.isFinite(Number(existingLayout.order))) {
        existingLayout.order = mmapHotLayoutOrder;
        mmapHotLayoutOrder += 1;
      }
      existingLayout.group = typeof existingLayout.group === 'string' && existingLayout.group
        ? existingLayout.group
        : 'mmap-hot';
      if (typeof existingLayout.contiguous !== 'boolean') {
        existingLayout.contiguous = true;
      }
    } else {
      existingLayout.group = typeof existingLayout.group === 'string' && existingLayout.group
        ? existingLayout.group
        : (tier === 'cold' ? 'cold-storage' : 'warm-storage');
      if (typeof existingLayout.contiguous !== 'boolean') {
        existingLayout.contiguous = false;
      }
    }
    const normalizedEntry = {
      ...entry,
      tier,
      layout: existingLayout,
      path: normalizedPath
    };
    pieceEntries.push(normalizedEntry);
    if (!pieceEntriesByPath.has(normalizedPath)) {
      pieceEntriesByPath.set(normalizedPath, []);
    }
    pieceEntriesByPath.get(normalizedPath).push(normalizedEntry);
  };
  const updatePieceMetadata = (piecePath, meta = {}) => {
    if (typeof piecePath !== 'string' || !piecePath) return;
    const targets = pieceEntriesByPath.get(piecePath);
    if (!Array.isArray(targets) || !targets.length) return;
    const bytes = Number(meta?.bytes);
    const checksumValue = typeof meta?.checksum === 'string' ? meta.checksum.trim().toLowerCase() : null;
    const checksumAlgo = typeof meta?.checksumAlgo === 'string' ? meta.checksumAlgo.trim().toLowerCase() : null;
    for (const entry of targets) {
      if (Number.isFinite(bytes) && bytes >= 0) entry.bytes = bytes;
      if (checksumValue && checksumAlgo) {
        entry.checksum = `${checksumAlgo}:${checksumValue}`;
      } else if (typeof meta?.checksumHash === 'string' && meta.checksumHash.includes(':')) {
        entry.checksum = meta.checksumHash.trim().toLowerCase();
      }
    }
  };
  addPieceFile({ type: 'stats', name: 'filelists', format: 'json' }, path.join(outDir, '.filelists.json'));
  const logWriteProgress = (label) => {
    completedWrites += 1;
    if (label) lastWriteLabel = label;
    showProgress('Artifacts', completedWrites, totalWrites, {
      ...writeProgressMeta,
      message: label || null
    });
    const now = Date.now();
    if (completedWrites === totalWrites || completedWrites === 1 || (now - lastWriteLog) >= writeLogIntervalMs) {
      lastWriteLog = now;
      const percent = totalWrites > 0
        ? (completedWrites / totalWrites * 100).toFixed(1)
        : '100.0';
      const suffix = lastWriteLabel ? ` | ${lastWriteLabel}` : '';
      logLine(`Writing index files ${completedWrites}/${totalWrites} (${percent}%)${suffix}`, { kind: 'status' });
    }
  };
  const recordArtifactMetric = (label, metric) => {
    if (!label) return;
    const existing = artifactMetrics.get(label) || { path: label };
    const nextMetric = { ...existing, ...metric };
    const queueDelayMs = Number(metric?.queueDelayMs);
    if (Number.isFinite(queueDelayMs) && queueDelayMs >= 0) {
      const samples = artifactQueueDelaySamples.get(label) || [];
      samples.push(Math.round(queueDelayMs));
      artifactQueueDelaySamples.set(label, samples);
      const queueDelayHistogram = summarizeQueueDelayHistogram(samples);
      if (queueDelayHistogram) {
        nextMetric.queueDelayHistogram = queueDelayHistogram;
        nextMetric.queueDelayP50Ms = queueDelayHistogram.p50Ms;
        nextMetric.queueDelayP95Ms = queueDelayHistogram.p95Ms;
      }
    }
    artifactMetrics.set(label, nextMetric);
  };
  const startWriteHeartbeat = () => {
    if (writeProgressHeartbeatMs <= 0 || writeHeartbeatTimer) return;
    writeHeartbeatTimer = setInterval(() => {
      if (!activeWrites.size || completedWrites >= totalWrites) return;
      const now = Date.now();
      const inflight = Array.from(activeWrites.entries())
        .map(([label, startedAt]) => ({
          label,
          elapsedSec: Math.max(1, Math.round((now - startedAt) / 1000)),
          estimatedBytes: Number(activeWriteBytes.get(label)) || null
        }))
        .sort((a, b) => b.elapsedSec - a.elapsedSec);
      for (const { label, elapsedSec, estimatedBytes } of inflight) {
        const alerts = writeStallAlerts.get(label) || new Set();
        for (let thresholdIndex = 0; thresholdIndex < normalizedWriteStallThresholds.length; thresholdIndex += 1) {
          const thresholdSec = normalizedWriteStallThresholds[thresholdIndex];
          if (alerts.has(thresholdSec) || elapsedSec < thresholdSec) continue;
          alerts.add(thresholdSec);
          writeStallAlerts.set(label, alerts);
          const levelName = stallThresholdLevelName(thresholdSec, thresholdIndex);
          logLine(
            `[perf] artifact write stall ${levelName}: ${label} in-flight for ${elapsedSec}s ` +
            `(threshold=${thresholdSec}s)`,
            { kind: thresholdSec >= 30 ? 'error' : 'warning' }
          );
          if (stageCheckpoints?.record) {
            stageCheckpoints.record({
              stage: 'artifacts',
              step: `write-stall-${thresholdSec}s`,
              label,
              extra: {
                elapsedSec,
                thresholdSec,
                level: levelName,
                estimatedBytes
              }
            });
          }
        }
      }
      const preview = inflight.slice(0, 3)
        .map(({ label, elapsedSec, estimatedBytes }) => (
          `${label} (${elapsedSec}s${Number.isFinite(estimatedBytes) ? `, ~${formatBytes(estimatedBytes)}` : ''})`
        ))
        .join(', ');
      const suffix = inflight.length > 3 ? ` (+${inflight.length - 3} more)` : '';
      logLine(
        `Writing index files ${completedWrites}/${totalWrites} | in-flight: ${preview}${suffix}`,
        { kind: 'status' }
      );
    }, writeProgressHeartbeatMs);
    if (typeof writeHeartbeatTimer?.unref === 'function') {
      writeHeartbeatTimer.unref();
    }
  };
  const stopWriteHeartbeat = () => {
    if (!writeHeartbeatTimer) return;
    clearInterval(writeHeartbeatTimer);
    writeHeartbeatTimer = null;
  };
  const resolveEagerSchedulerTokens = (estimatedBytes, laneHint) => {
    const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
    if (laneHint === 'massive') {
      const massiveMem = Math.max(memTokens, massiveWriteMemTokens);
      return massiveMem > 0
        ? { io: massiveWriteIoTokens, mem: massiveMem }
        : { io: massiveWriteIoTokens };
    }
    return memTokens > 0 ? { io: 1, mem: memTokens } : { io: 1 };
  };
  const enqueueWrite = (label, job, meta = {}) => {
    const parsedPriority = Number(meta?.priority);
    const priority = Number.isFinite(parsedPriority) ? parsedPriority : 0;
    const parsedEstimatedBytes = Number(meta?.estimatedBytes);
    const estimatedBytes = Number.isFinite(parsedEstimatedBytes) && parsedEstimatedBytes >= 0
      ? parsedEstimatedBytes
      : null;
    const laneHint = typeof meta?.laneHint === 'string' ? meta.laneHint : null;
    const eagerStart = meta?.eagerStart === true;
    let prefetched = null;
    let prefetchStartedAt = null;
    if (eagerStart && typeof job === 'function') {
      prefetchStartedAt = Date.now();
      const tokens = resolveEagerSchedulerTokens(estimatedBytes, laneHint);
      prefetched = scheduler?.schedule
        ? scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2Write, tokens, job)
        : job();
      Promise.resolve(prefetched).catch(() => {});
    }
    writes.push({
      label,
      priority,
      estimatedBytes,
      laneHint,
      eagerStart,
      prefetched,
      prefetchStartedAt,
      seq: enqueueSeq,
      enqueuedAt: Date.now(),
      job
    });
    enqueueSeq += 1;
  };
  const resolveWriteWeight = (entry) => {
    if (!entry || typeof entry !== 'object') return 0;
    let weight = Number.isFinite(entry.priority) ? entry.priority : 0;
    if (isValidationCriticalArtifact(entry.label)) {
      // Keep strict-validation-critical artifacts ahead of optional debug/derived
      // outputs when the write queue is saturated.
      weight += 500;
    }
    // Keep FIFO ordering unless a write has explicit priority.
    if (weight > 0 && Number.isFinite(entry.estimatedBytes) && entry.estimatedBytes > 0) {
      weight += Math.log2(entry.estimatedBytes + 1);
    }
    return weight;
  };
  const scheduleWrites = (entries) => (
    Array.isArray(entries)
      ? entries.slice().sort((a, b) => {
        const delta = resolveWriteWeight(b) - resolveWriteWeight(a);
        if (delta !== 0) return delta;
        const aSeq = Number.isFinite(a?.seq) ? a.seq : 0;
        const bSeq = Number.isFinite(b?.seq) ? b.seq : 0;
        return aSeq - bSeq;
      })
      : []
  );
  const splitWriteLanes = (entries) => {
    const ordered = scheduleWrites(entries);
    const lanes = {
      ultraLight: [],
      light: [],
      heavy: [],
      massive: []
    };
    for (const entry of ordered) {
      const estimated = Number(entry?.estimatedBytes);
      const label = typeof entry?.label === 'string' ? entry.label : '';
      const isForcedMassive = forcedMassiveWritePatterns.some((pattern) => pattern.test(label));
      const isForcedHeavy = forcedHeavyWritePatterns.some((pattern) => pattern.test(label));
      const isForcedUltraLight = forcedUltraLightWritePatterns.some((pattern) => pattern.test(label));
      const isMassiveBySize = Number.isFinite(estimated) && estimated >= massiveWriteThresholdBytes;
      const isMassive = isForcedMassive || isMassiveBySize;
      const isHeavyBySize = Number.isFinite(estimated) && estimated >= heavyWriteThresholdBytes;
      const isHeavy = isForcedHeavy || isHeavyBySize;
      const isUltraLightBySize = Number.isFinite(estimated)
        && estimated > 0
        && estimated <= ultraLightWriteThresholdBytes;
      if (isMassive) {
        lanes.massive.push(entry);
      } else if (isHeavy) {
        lanes.heavy.push(entry);
      } else if (isForcedUltraLight || isUltraLightBySize) {
        lanes.ultraLight.push(entry);
      } else {
        lanes.light.push(entry);
      }
    }
    return lanes;
  };
  if (mode === 'extracted-prose' && documentExtractionEnabled) {
    const extractionReportPath = path.join(outDir, 'extraction_report.json');
    const extractionReport = buildExtractionReport({
      state,
      root,
      mode,
      documentExtractionConfig: indexingConfig.documentExtraction || {}
    });
    enqueueWrite(
      formatArtifactLabel(extractionReportPath),
      async () => {
        await writeJsonObjectFile(extractionReportPath, {
          fields: extractionReport,
          atomic: true
        });
      }
    );
    addPieceFile({ type: 'stats', name: 'extraction_report', format: 'json' }, extractionReportPath);
  }
  const lexiconRelationFilterReport = buildLexiconRelationFilterReport({ state, mode });
  if (Array.isArray(lexiconRelationFilterReport.files) && lexiconRelationFilterReport.files.length) {
    const lexiconReportPath = path.join(outDir, 'lexicon_relation_filter_report.json');
    enqueueWrite(
      formatArtifactLabel(lexiconReportPath),
      async () => {
        await writeJsonObjectFile(lexiconReportPath, {
          fields: lexiconRelationFilterReport,
          atomic: true
        });
      }
    );
    addPieceFile({ type: 'stats', name: 'lexicon_relation_filter_report', format: 'json' }, lexiconReportPath);
    if (indexState && typeof indexState === 'object') {
      if (!indexState.extensions || typeof indexState.extensions !== 'object') {
        indexState.extensions = {};
      }
      indexState.extensions.lexiconRelationFilter = {
        schemaVersion: 1,
        totals: lexiconRelationFilterReport.totals
      };
    }
  }
  const boilerplateCatalog = buildBoilerplateCatalog(state?.chunks);
  if (boilerplateCatalog.length) {
    const boilerplateCatalogPath = path.join(outDir, 'boilerplate_catalog.json');
    enqueueWrite(
      formatArtifactLabel(boilerplateCatalogPath),
      async () => {
        await writeJsonObjectFile(boilerplateCatalogPath, {
          fields: {
            schemaVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
            entries: boilerplateCatalog
          },
          atomic: true
        });
      }
    );
    addPieceFile({ type: 'stats', name: 'boilerplate_catalog', format: 'json' }, boilerplateCatalogPath);
  }
  if (indexState && typeof indexState === 'object') {
    const indexStatePath = path.join(outDir, 'index_state.json');
    const indexStateMetaPath = path.join(outDir, 'index_state.meta.json');
    const determinismReportPath = path.join(outDir, 'determinism_report.json');
    const stableState = stripIndexStateNondeterministicFields(indexState, { forStableHash: true });
    const stableHash = sha1(stableStringifyForSignature(stableState));
    const determinismReport = buildDeterminismReport({
      mode,
      indexState
    });
    let canSkipIndexState = false;
    try {
      if (fsSync.existsSync(indexStateMetaPath) && fsSync.existsSync(indexStatePath)) {
        const metaRaw = readJsonFile(indexStateMetaPath, { maxBytes: maxJsonBytes });
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        if (meta?.stableHash === stableHash) {
          canSkipIndexState = true;
        }
      }
    } catch {}
    const indexStateWarnBytes = Math.max(1024 * 64, Math.floor(maxJsonBytes * 0.1));
    const indexStateCompressThreshold = Math.max(1024 * 128, Math.floor(maxJsonBytes * 0.2));
    const writeIndexStateMeta = async (bytes) => {
      await writeJsonObjectFile(indexStateMetaPath, {
        fields: {
          stableHash,
          generatedAt: indexState.generatedAt || null,
          updatedAt: new Date().toISOString(),
          bytes: Number.isFinite(bytes) ? bytes : null
        },
        atomic: true
      });
    };
    enqueueWrite(
      formatArtifactLabel(determinismReportPath),
      async () => {
        await writeJsonObjectFile(determinismReportPath, {
          fields: determinismReport,
          atomic: true
        });
      }
    );
    if (!canSkipIndexState) {
      enqueueWrite(
        formatArtifactLabel(indexStatePath),
        async () => {
          await writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true });
          let bytes = null;
          try {
            const stat = await fs.stat(indexStatePath);
            bytes = stat.size;
          } catch {}
          if (Number.isFinite(bytes) && bytes > indexStateWarnBytes) {
            log(
              `index_state ~${formatBytes(bytes)}; consider pruning volatile fields or enabling compression.`
            );
          }
          if (compressionEnabled && compressionMode && Number.isFinite(bytes) && bytes > indexStateCompressThreshold) {
            const compressedPath = path.join(
              outDir,
              `index_state.${compressionMode === 'zstd' ? 'json.zst' : 'json.gz'}`
            );
            await writeJsonObjectFile(compressedPath, {
              fields: indexState,
              compression: compressionMode,
              gzipOptions: compressionGzipOptions,
              atomic: true
            });
          }
          await writeIndexStateMeta(bytes);
        }
      );
    } else {
      enqueueWrite(
        formatArtifactLabel(indexStateMetaPath),
        async () => {
          let bytes = null;
          try {
            const stat = await fs.stat(indexStatePath);
            bytes = stat.size;
          } catch {}
          await writeIndexStateMeta(bytes);
        }
      );
    }
    addPieceFile({ type: 'stats', name: 'index_state', format: 'json' }, indexStatePath);
    addPieceFile({ type: 'stats', name: 'determinism_report', format: 'json' }, determinismReportPath);
  }
  const { enqueueJsonObject, enqueueJsonArray, enqueueJsonArraySharded } = createArtifactWriter({
    outDir,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    compressionGzipOptions,
    compressionMinBytes,
    compressionMaxBytes,
    compressibleArtifacts,
    compressionOverrides: tieredCompressionOverrides,
    jsonArraySerializeShardThresholdMs,
    jsonArraySerializeShardMaxBytes,
    jsonlShapeAware: writeJsonlShapeAware,
    jsonlLargeThresholdBytes: writeJsonlLargeThresholdBytes,
    jsonlPresizeEnabled: writeFsStrategy.presizeJsonl
  });
  if (state.importResolutionGraph) {
    const importGraphDir = path.join(outDir, 'artifacts');
    const importGraphPath = path.join(importGraphDir, 'import_resolution_graph.json');
    enqueueWrite(
      formatArtifactLabel(importGraphPath),
      async () => {
        await fs.mkdir(importGraphDir, { recursive: true });
        await writeJsonObjectFile(importGraphPath, {
          fields: state.importResolutionGraph,
          atomic: true
        });
      }
    );
    addPieceFile(
      { type: 'debug', name: 'import_resolution_graph', format: 'json' },
      importGraphPath
    );
  }

  const denseVectorsEnabled = postings.dims > 0 && postings.quantizedVectors.length;
  if (!denseVectorsEnabled) {
    await removeArtifact(path.join(outDir, 'dense_vectors_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_doc_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_doc_uint8', removeArtifact });
    await removeArtifact(path.join(outDir, 'dense_vectors_code_uint8.json'));
    await removeCompressedArtifact({ outDir, base: 'dense_vectors_code_uint8', removeArtifact });
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors',
        count: postings.quantizedVectors.length,
        dims: postings.dims
      }
    });
  }
  const fileMetaEstimatedBytes = estimateJsonBytes(fileMeta);
  const fileMetaFormat = fileMetaFormatConfig || 'auto';
  const fileMetaExceedsMax = Number.isFinite(fileMetaMaxBytes)
    ? fileMetaEstimatedBytes > fileMetaMaxBytes
    : false;
  const fileMetaAutoUseJsonl = fileMetaFormat === 'auto'
    && Number.isFinite(fileMetaJsonlThreshold)
    && fileMetaJsonlThreshold > 0
    && fileMetaEstimatedBytes >= fileMetaJsonlThreshold;
  const fileMetaUseColumnar = !fileMetaExceedsMax
    && fileMetaFormat === 'columnar'
    && fileMetaEstimatedBytes >= fileMetaColumnarThreshold;
  const fileMetaUseJsonl = fileMetaFormat === 'jsonl'
    || fileMetaAutoUseJsonl
    || fileMetaExceedsMax
    || (!fileMetaUseColumnar && Number.isFinite(fileMetaMaxBytes)
      && fileMetaEstimatedBytes > fileMetaMaxBytes);
  applyByteBudget({
    budget: fileMetaBudget,
    totalBytes: fileMetaEstimatedBytes,
    label: 'file_meta',
    stageCheckpoints,
    logger: log
  });
  const fileMetaMetaPath = path.join(outDir, 'file_meta.meta.json');
  if (!fileMetaFromCache) {
    if (fileMetaUseColumnar) {
      const columnarPath = path.join(outDir, 'file_meta.columnar.json');
      enqueueWrite(
        formatArtifactLabel(columnarPath),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact({ outDir, base: 'file_meta', removeArtifact });
          await removeArtifact(path.join(outDir, 'file_meta.parts'));
          const payload = buildFileMetaColumnar(fileMeta);
          await writeJsonObjectFile(columnarPath, { fields: payload, atomic: true });
          await writeJsonObjectFile(fileMetaMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              artifact: 'file_meta',
              format: 'columnar',
              generatedAt: new Date().toISOString(),
              compression: 'none',
              totalRecords: fileMeta.length,
              totalBytes: fileMetaEstimatedBytes,
              maxPartRecords: fileMeta.length,
              maxPartBytes: fileMetaEstimatedBytes,
              targetMaxBytes: null,
              parts: [{ path: 'file_meta.columnar.json', records: fileMeta.length, bytes: fileMetaEstimatedBytes }],
              cacheKey: fileMetaCacheKey || null,
              extensions: {
                fingerprint: fileMetaFingerprint || null,
                cacheKey: fileMetaCacheKey || null
              }
            },
            atomic: true
          });
        }
      );
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'columnar', count: fileMeta.length }, columnarPath);
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else if (fileMetaUseJsonl) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'file_meta.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'file_meta.json'));
          await removeCompressedArtifact({ outDir, base: 'file_meta', removeArtifact });
        }
      );
      enqueueJsonArraySharded('file_meta', fileMeta, {
        maxBytes: fileMetaShardedMaxBytes || fileMetaMaxBytes,
        estimatedBytes: fileMetaEstimatedBytes,
        piece: { type: 'chunks', name: 'file_meta' },
        metaExtensions: { fingerprint: fileMetaFingerprint || null, cacheKey: fileMetaCacheKey || null },
        compression: null,
        gzipOptions: null,
        offsets: true
      });
    } else {
      enqueueJsonArray('file_meta', fileMeta, {
        compressible: false,
        piece: { type: 'chunks', name: 'file_meta', count: fileMeta.length }
      });
      enqueueWrite(
        formatArtifactLabel(fileMetaMetaPath),
        async () => {
          await writeJsonObjectFile(fileMetaMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              artifact: 'file_meta',
              format: 'json',
              generatedAt: new Date().toISOString(),
              compression: 'none',
              totalRecords: fileMeta.length,
              totalBytes: fileMetaEstimatedBytes,
              maxPartRecords: fileMeta.length,
              maxPartBytes: fileMetaEstimatedBytes,
              targetMaxBytes: null,
              parts: [{ path: 'file_meta.json', records: fileMeta.length, bytes: fileMetaEstimatedBytes }],
              cacheKey: fileMetaCacheKey || null,
              extensions: {
                fingerprint: fileMetaFingerprint || null,
                cacheKey: fileMetaCacheKey || null
              }
            },
            atomic: true
          });
        }
      );
    }
  } else {
    const cachedFormat = typeof fileMetaMeta?.format === 'string' ? fileMetaMeta.format : 'json';
    if (cachedFormat === 'jsonl-sharded' && Array.isArray(fileMetaMeta?.parts)) {
      for (const part of fileMetaMeta.parts) {
        const relPath = typeof part === 'string' ? part : part?.path;
        if (!relPath) continue;
        const absPath = path.join(outDir, relPath);
        addPieceFile({
          type: 'chunks',
          name: 'file_meta',
          format: 'jsonl',
          count: typeof part === 'object' && Number.isFinite(part.records) ? part.records : null,
          compression: fileMetaMeta?.compression || null
        }, absPath);
      }
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else if (cachedFormat === 'columnar' && Array.isArray(fileMetaMeta?.parts)) {
      const part = fileMetaMeta.parts[0];
      const relPath = typeof part === 'string' ? part : part?.path;
      if (relPath) {
        const absPath = path.join(outDir, relPath);
        addPieceFile({
          type: 'chunks',
          name: 'file_meta',
          format: 'columnar',
          count: typeof part === 'object' && Number.isFinite(part.records) ? part.records : null
        }, absPath);
      }
      addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
    } else {
      addPieceFile({ type: 'chunks', name: 'file_meta', format: 'json', count: fileMeta.length }, path.join(outDir, 'file_meta.json'));
      if (fsSync.existsSync(fileMetaMetaPath)) {
        addPieceFile({ type: 'chunks', name: 'file_meta_meta', format: 'json' }, fileMetaMetaPath);
      }
    }
  }
  if (denseVectorsEnabled) {
    enqueueJsonObject('dense_vectors_doc_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedDocVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_doc',
        count: postings.quantizedDocVectors.length,
        dims: postings.dims
      }
    });
    enqueueJsonObject('dense_vectors_code_uint8', {
      fields: { model: modelId, dims: postings.dims, scale: denseScale },
      arrays: { vectors: postings.quantizedCodeVectors }
    }, {
      piece: {
        type: 'embeddings',
        name: 'dense_vectors_code',
        count: postings.quantizedCodeVectors.length,
        dims: postings.dims
      }
    });
  }
  const chunkMetaCompression = resolveShardCompression('chunk_meta');
  const chunkMetaOrdering = await enqueueChunkMetaArtifacts({
    state,
    outDir,
    mode,
    chunkMetaIterator,
    chunkMetaPlan,
    maxJsonBytes: chunkMetaMaxBytes,
    byteBudget: chunkMetaBudget,
    compression: chunkMetaCompression,
    gzipOptions: chunkMetaCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueJsonArray,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  await recordOrdering('chunk_meta', chunkMetaOrdering, 'chunk_meta:compareChunkMetaRows');
  const chunkUidMapCompression = resolveShardCompression('chunk_uid_map');
  await enqueueChunkUidMapArtifacts({
    outDir,
    mode,
    chunks: state.chunks,
    maxJsonBytes: chunkUidMapMaxBytes,
    byteBudget: chunkUidMapBudget,
    compression: chunkUidMapCompression,
    gzipOptions: chunkUidMapCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const vfsManifestCompression = resolveShardCompression('vfs_manifest');
  await enqueueVfsManifestArtifacts({
    outDir,
    mode,
    rows: state.vfsManifestCollector || state.vfsManifestRows,
    maxJsonBytes: vfsMaxBytes,
    byteBudget: vfsBudget,
    compression: vfsManifestCompression,
    gzipOptions: vfsManifestCompression === 'gzip' ? compressionGzipOptions : null,
    hashRouting: vfsHashRouting,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  const repoMapMeasurement = measureRepoMap({ repoMapIterator, maxJsonBytes: repoMapMaxBytes });
  const useRepoMapJsonl = repoMapMeasurement.totalEntries
    && repoMapMaxBytes
    && repoMapMeasurement.totalBytes > repoMapMaxBytes;
  await ensureDiskSpace({
    targetPath: outDir,
    requiredBytes: useRepoMapJsonl ? repoMapMeasurement.totalJsonlBytes : repoMapMeasurement.totalBytes,
    label: `${mode} repo_map`
  });
  const repoMapCompression = resolveShardCompression('repo_map');
  await enqueueRepoMapArtifacts({
    outDir,
    repoMapIterator,
    repoMapMeasurement,
    useRepoMapJsonl,
    maxJsonBytes: repoMapMaxBytes,
    byteBudget: repoMapBudget,
    repoMapCompression,
    compressionGzipOptions,
    log,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact,
    stageCheckpoints
  });
  await recordOrdering('repo_map', repoMapMeasurement, 'repo_map:file,name,kind,signature,startLine');
  if (filterIndex) {
    enqueueJsonObject('filter_index', { fields: filterIndex }, {
      compressible: false,
      piece: { type: 'chunks', name: 'filter_index' }
    });
  } else if (filterIndexFallback?.path) {
    const normalizedFilterIndexPath = formatArtifactLabel(filterIndexFallback.path);
    filterIndexFallback.piece.path = normalizedFilterIndexPath;
    addPieceFile(filterIndexFallback.piece, filterIndexFallback.path);
    if (indexState?.filterIndex && typeof indexState.filterIndex === 'object') {
      indexState.filterIndex.path = normalizedFilterIndexPath;
    }
  }
  const minhashFromPostings = Array.isArray(postings.minhashSigs) && postings.minhashSigs.length
    ? postings.minhashSigs
    : null;
  const minhashSamplingMeta = postings?.minhashGuard?.sampled === true
    ? {
      mode: typeof postings?.minhashGuard?.mode === 'string'
        ? postings.minhashGuard.mode
        : 'sampled-minified',
      maxDocs: Number.isFinite(Number(postings?.minhashGuard?.maxDocs))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.maxDocs)))
        : null,
      totalDocs: Number.isFinite(Number(postings?.minhashGuard?.totalDocs))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.totalDocs)))
        : null,
      signatureLength: Number.isFinite(Number(postings?.minhashGuard?.signatureLength))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.signatureLength)))
        : null,
      sampledSignatureLength: Number.isFinite(Number(postings?.minhashGuard?.sampledSignatureLength))
        ? Math.max(0, Math.floor(Number(postings.minhashGuard.sampledSignatureLength)))
        : null,
      hashStride: Number.isFinite(Number(postings?.minhashGuard?.hashStride))
        ? Math.max(1, Math.floor(Number(postings.minhashGuard.hashStride)))
        : null,
      density: Number.isFinite(Number(postings?.minhashGuard?.density))
        ? Number(postings.minhashGuard.density)
        : null
    }
    : null;
  const minhashStream = postings.minhashStream && Array.isArray(state?.chunks) && state.chunks.length;
  const minhashCount = minhashFromPostings
    ? postings.minhashSigs.length
    : (minhashStream ? state.chunks.length : (postings.minhashSigs?.length || 0));
  const minhashIterable = minhashFromPostings
    ? minhashFromPostings
    : (minhashStream
      ? (function* () {
        for (const chunk of state.chunks) {
          yield chunk?.minhashSig;
        }
      })()
      : (postings.minhashSigs || []));
  const packedMinhash = sparseArtifactsEnabled
    ? packMinhashSignatures({
      signatures: minhashFromPostings,
      chunks: minhashStream ? state.chunks : null
    })
    : null;
  if (packedMinhash?.coercedRows && typeof log === 'function') {
    log(
      `[minhash] packed signatures coerced ${packedMinhash.coercedRows} row(s) `
      + `to match dims=${packedMinhash.dims}.`
    );
  }
  const skipMinhashJsonForLarge = sparseArtifactsEnabled
    && packedMinhash
    && minhashCount >= minhashJsonLargeThreshold;
  if (skipMinhashJsonForLarge && typeof log === 'function') {
    log(
      `[minhash] skipping minhash_signatures.json for large index `
      + `(count=${minhashCount}, threshold=${minhashJsonLargeThreshold}); using packed artifact.`
    );
  }
  if (skipMinhashJsonForLarge) {
    await Promise.all([
      removeArtifact(path.join(outDir, 'minhash_signatures.json'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.json.gz'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.json.zst'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.meta.json'), { policy: 'format_cleanup' }),
      removeArtifact(path.join(outDir, 'minhash_signatures.parts'), {
        recursive: true,
        policy: 'format_cleanup'
      })
    ]);
  }
  if (sparseArtifactsEnabled && !skipMinhashJsonForLarge) {
    enqueueJsonObject('minhash_signatures', {
      fields: minhashSamplingMeta ? { sampling: minhashSamplingMeta } : undefined,
      arrays: { signatures: minhashIterable }
    }, {
      piece: {
        type: 'postings',
        name: 'minhash_signatures',
        count: minhashCount
      }
    });
  }
  if (packedMinhash) {
    const packedChecksum = computePackedChecksum(packedMinhash.buffer);
    const packedPath = path.join(outDir, 'minhash_signatures.packed.bin');
    const packedMetaPath = path.join(outDir, 'minhash_signatures.packed.meta.json');
    enqueueWrite(
      formatArtifactLabel(packedPath),
      async () => {
        await fs.writeFile(packedPath, packedMinhash.buffer);
        await writeJsonObjectFile(packedMetaPath, {
          fields: {
            format: 'u32',
            endian: 'le',
            dims: packedMinhash.dims,
            count: packedMinhash.count,
            checksum: packedChecksum.hash,
            ...(minhashSamplingMeta ? { sampling: minhashSamplingMeta } : {})
          },
          atomic: true
        });
      }
    );
    addPieceFile({
      type: 'postings',
      name: 'minhash_signatures_packed',
      format: 'bin',
      count: packedMinhash.count
    }, packedPath);
    addPieceFile({ type: 'postings', name: 'minhash_signatures_packed_meta', format: 'json' }, packedMetaPath);
  } else {
    await removePackedMinhash({ outDir, removeArtifact });
  }
  const tokenPostingsCompression = resolveShardCompression('token_postings');
  if (sparseArtifactsEnabled) {
    await enqueueTokenPostingsArtifacts({
      outDir,
      postings,
      state,
      tokenPostingsFormat,
      tokenPostingsUseShards,
      tokenPostingsShardSize,
      tokenPostingsBinaryColumnar,
      tokenPostingsCompression,
      writePriority: 210,
      tokenPostingsEstimatedBytes: tokenPostingsEstimate?.estimatedBytes || null,
      enqueueJsonObject,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel
    });
  }
  const vocabOrder = {};
  const tokenOrdering = measureVocabOrdering(postings.tokenVocab);
  await recordOrdering('token_vocab', tokenOrdering, 'token_vocab:token');
  if (tokenOrdering.orderingHash) {
    vocabOrder.token = {
      hash: tokenOrdering.orderingHash,
      count: tokenOrdering.orderingCount
    };
  }
  if (sparseArtifactsEnabled && postings.fieldPostings?.fields) {
    const fieldPostingsObject = postings.fieldPostings.fields;
    const fieldPostingsEstimatedBytes = estimateJsonBytes(fieldPostingsObject);
    const fieldNames = Object.keys(fieldPostingsObject);
    const shouldShardFieldPostings = fieldPostingsShardsEnabled
      && fieldPostingsShardThresholdBytes > 0
      && fieldPostingsEstimatedBytes >= fieldPostingsShardThresholdBytes
      && fieldNames.length > 1;
    if (shouldShardFieldPostings) {
      const shardsDirPath = path.join(outDir, 'field_postings.shards');
      const shardsMetaPath = path.join(outDir, 'field_postings.shards.meta.json');
      await removeArtifact(shardsDirPath, { recursive: true, policy: 'format_cleanup' });
      await fs.mkdir(shardsDirPath, { recursive: true });
      const resolvedFieldPostingsShardCount = resolveAdaptiveShardCount({
        estimatedBytes: fieldPostingsEstimatedBytes,
        rowCount: fieldNames.length,
        throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
        minShards: fieldPostingsShardMinCount,
        maxShards: fieldPostingsShardMaxCount,
        defaultShards: fieldPostingsShardCount,
        targetShardBytes: fieldPostingsShardTargetBytes,
        targetShardSeconds: fieldPostingsShardTargetSeconds
      });
      const shardSize = Math.max(1, Math.ceil(fieldNames.length / resolvedFieldPostingsShardCount));
      const partFiles = [];
      for (let shardIndex = 0; shardIndex < resolvedFieldPostingsShardCount; shardIndex += 1) {
        const start = shardIndex * shardSize;
        const end = Math.min(fieldNames.length, start + shardSize);
        if (start >= end) break;
        const relPath = `field_postings.shards/field_postings.part-${String(shardIndex).padStart(4, '0')}.json`;
        const absPath = path.join(outDir, relPath);
        partFiles.push({ relPath, count: end - start, absPath, start, end });
      }
      const partEstimatedBytes = Math.max(
        1,
        Math.floor(fieldPostingsEstimatedBytes / Math.max(1, partFiles.length))
      );
      const writeFieldPostingsPartition = async (part) => {
        const startedAt = Date.now();
        let serializationMs = 0;
        let diskMs = 0;
        const {
          stream,
          done,
          getBytesWritten,
          getChecksum,
          checksumAlgo
        } = createJsonWriteStream(part.absPath, { atomic: true, checksumAlgo: 'sha1' });
        try {
          let writeStart = Date.now();
          await writeChunk(stream, '{"fields":{');
          diskMs += Math.max(0, Date.now() - writeStart);
          let first = true;
          for (let index = part.start; index < part.end; index += 1) {
            const field = fieldNames[index];
            const value = fieldPostingsObject[field];
            const serializeStart = Date.now();
            const row = `${first ? '' : ','}${JSON.stringify(field)}:${JSON.stringify(value)}`;
            serializationMs += Math.max(0, Date.now() - serializeStart);
            writeStart = Date.now();
            await writeChunk(stream, row);
            diskMs += Math.max(0, Date.now() - writeStart);
            first = false;
          }
          writeStart = Date.now();
          await writeChunk(stream, '}}\n');
          stream.end();
          await done;
          diskMs += Math.max(0, Date.now() - writeStart);
          return {
            bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
            checksum: typeof getChecksum === 'function' ? getChecksum() : null,
            checksumAlgo: checksumAlgo || null,
            serializationMs,
            diskMs,
            directFdStreaming: true,
            durationMs: Math.max(0, Date.now() - startedAt)
          };
        } catch (err) {
          try { stream.destroy(err); } catch {}
          try { await done; } catch {}
          throw err;
        }
      };
      for (const part of partFiles) {
        enqueueWrite(
          part.relPath,
          () => writeFieldPostingsPartition(part),
          { priority: 206, estimatedBytes: partEstimatedBytes }
        );
        addPieceFile({
          type: 'postings',
          name: 'field_postings_shard',
          format: 'json',
          count: part.count
        }, part.absPath);
      }
      enqueueWrite(
        formatArtifactLabel(shardsMetaPath),
        async () => {
          await writeJsonObjectFile(shardsMetaPath, {
            fields: {
              schemaVersion: '1.0.0',
              generatedAt: new Date().toISOString(),
              shardCount: partFiles.length,
              estimatedBytes: fieldPostingsEstimatedBytes,
              fields: fieldNames.length,
              shardTargetBytes: fieldPostingsShardTargetBytes,
              throughputBytesPerSec: artifactWriteThroughputBytesPerSec,
              parts: partFiles.map((part) => ({
                path: part.relPath,
                fields: part.count
              })),
              merge: {
                strategy: 'streaming-partition-merge',
                outputPath: 'field_postings.json'
              }
            },
            atomic: true
          });
        },
        { priority: 207, estimatedBytes: Math.max(1024, partFiles.length * 128) }
      );
      addPieceFile({ type: 'postings', name: 'field_postings_shards_meta', format: 'json' }, shardsMetaPath);
      if (typeof log === 'function') {
        log(
          `field_postings estimate ~${formatBytes(fieldPostingsEstimatedBytes)}; ` +
          `emitting streamed shards (${partFiles.length} planned, target=${formatBytes(fieldPostingsShardTargetBytes)}).`
        );
      }
      if (!fieldPostingsKeepLegacyJson && typeof log === 'function') {
        log(
          '[warn] fieldPostingsKeepLegacyJson=false ignored while shard readers are unavailable; ' +
          'emitting field_postings.json for compatibility.'
        );
      }
      const writeLegacyFieldPostingsFromShards = async () => {
        const targetPath = path.join(outDir, 'field_postings.json');
        const startedAt = Date.now();
        let serializationMs = 0;
        let diskMs = 0;
        const {
          stream,
          done,
          getBytesWritten,
          getChecksum,
          checksumAlgo
        } = createJsonWriteStream(targetPath, { atomic: true, checksumAlgo: 'sha1' });
        try {
          let writeStart = Date.now();
          await writeChunk(stream, '{"fields":{');
          diskMs += Math.max(0, Date.now() - writeStart);
          let first = true;
          for (const part of partFiles) {
            for (let index = part.start; index < part.end; index += 1) {
              const field = fieldNames[index];
              const value = fieldPostingsObject[field];
              const serializeStart = Date.now();
              const row = `${first ? '' : ','}${JSON.stringify(field)}:${JSON.stringify(value)}`;
              serializationMs += Math.max(0, Date.now() - serializeStart);
              writeStart = Date.now();
              await writeChunk(stream, row);
              diskMs += Math.max(0, Date.now() - writeStart);
              first = false;
            }
          }
          writeStart = Date.now();
          await writeChunk(stream, '}}\n');
          stream.end();
          await done;
          diskMs += Math.max(0, Date.now() - writeStart);
          return {
            bytes: Number.isFinite(getBytesWritten?.()) ? getBytesWritten() : null,
            checksum: typeof getChecksum === 'function' ? getChecksum() : null,
            checksumAlgo: checksumAlgo || null,
            serializationMs,
            diskMs,
            directFdStreaming: true,
            durationMs: Math.max(0, Date.now() - startedAt)
          };
        } catch (err) {
          try { stream.destroy(err); } catch {}
          try { await done; } catch {}
          throw err;
        }
      };
      enqueueWrite(
        'field_postings.json',
        writeLegacyFieldPostingsFromShards,
        {
          priority: 204,
          estimatedBytes: fieldPostingsEstimatedBytes
        }
      );
      addPieceFile({ type: 'postings', name: 'field_postings' }, path.join(outDir, 'field_postings.json'));
    } else {
      enqueueJsonObject('field_postings', { fields: { fields: fieldPostingsObject } }, {
        piece: { type: 'postings', name: 'field_postings' },
        priority: 220,
        estimatedBytes: fieldPostingsEstimatedBytes
      });
    }
    const fieldPostingsBinaryDataPath = path.join(outDir, 'field_postings.binary-columnar.bin');
    const fieldPostingsBinaryOffsetsPath = path.join(outDir, 'field_postings.binary-columnar.offsets.bin');
    const fieldPostingsBinaryLengthsPath = path.join(outDir, 'field_postings.binary-columnar.lengths.varint');
    const fieldPostingsBinaryMetaPath = path.join(outDir, 'field_postings.binary-columnar.meta.json');
    const shouldWriteFieldPostingsBinary = fieldPostingsBinaryColumnar
      && fieldPostingsEstimatedBytes >= fieldPostingsBinaryColumnarThresholdBytes
      && fieldNames.length > 0;
    if (shouldWriteFieldPostingsBinary) {
      enqueueWrite(
        formatArtifactLabel(fieldPostingsBinaryMetaPath),
        async () => {
          const serializationStartedAt = Date.now();
          const rowPayloads = (async function* binaryRows() {
            for (const field of fieldNames) {
              yield JSON.stringify({
                field,
                postings: fieldPostingsObject[field]
              });
            }
          })();
          const binaryWriteHints = resolveBinaryColumnarWriteHints({
            estimatedBytes: fieldPostingsEstimatedBytes,
            rowCount: fieldNames.length,
            presize: writeFsStrategy.presizeJsonl
          });
          const frames = await writeBinaryRowFrames({
            rowBuffers: rowPayloads,
            dataPath: fieldPostingsBinaryDataPath,
            offsetsPath: fieldPostingsBinaryOffsetsPath,
            lengthsPath: fieldPostingsBinaryLengthsPath,
            writeHints: binaryWriteHints
          });
          const serializationMs = Math.max(0, Date.now() - serializationStartedAt);
          const diskStartedAt = Date.now();
          const binaryMetaResult = await writeJsonObjectFile(fieldPostingsBinaryMetaPath, {
            fields: {
              format: 'binary-columnar-v1',
              rowEncoding: 'json-rows',
              count: frames.count,
              data: path.basename(fieldPostingsBinaryDataPath),
              offsets: path.basename(fieldPostingsBinaryOffsetsPath),
              lengths: path.basename(fieldPostingsBinaryLengthsPath),
              estimatedSourceBytes: fieldPostingsEstimatedBytes,
              preallocatedBytes: Number.isFinite(frames?.preallocatedBytes) ? frames.preallocatedBytes : 0
            },
            checksumAlgo: 'sha1',
            atomic: true
          });
          return {
            bytes: Number.isFinite(Number(binaryMetaResult?.bytes)) ? Number(binaryMetaResult.bytes) : null,
            checksum: typeof binaryMetaResult?.checksum === 'string' ? binaryMetaResult.checksum : null,
            checksumAlgo: typeof binaryMetaResult?.checksumAlgo === 'string' ? binaryMetaResult.checksumAlgo : null,
            serializationMs,
            diskMs: Math.max(0, Date.now() - diskStartedAt),
            directFdStreaming: true
          };
        },
        {
          priority: 223,
          estimatedBytes: Math.max(fieldPostingsEstimatedBytes, fieldNames.length * 96)
        }
      );
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar',
        format: 'binary-columnar',
        count: fieldNames.length
      }, fieldPostingsBinaryDataPath);
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar_offsets',
        format: 'binary',
        count: fieldNames.length
      }, fieldPostingsBinaryOffsetsPath);
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar_lengths',
        format: 'varint',
        count: fieldNames.length
      }, fieldPostingsBinaryLengthsPath);
      addPieceFile({
        type: 'postings',
        name: 'field_postings_binary_columnar_meta',
        format: 'json'
      }, fieldPostingsBinaryMetaPath);
    } else {
      await Promise.all([
        removeArtifact(fieldPostingsBinaryDataPath, { policy: 'format_cleanup' }),
        removeArtifact(fieldPostingsBinaryOffsetsPath, { policy: 'format_cleanup' }),
        removeArtifact(fieldPostingsBinaryLengthsPath, { policy: 'format_cleanup' }),
        removeArtifact(fieldPostingsBinaryMetaPath, { policy: 'format_cleanup' })
      ]);
    }
  }
  if (sparseArtifactsEnabled && resolvedConfig.fielded !== false && Array.isArray(state.fieldTokens)) {
    const fieldTokensEstimatedBytes = estimateJsonBytes(state.fieldTokens);
    const fieldTokensUseShards = fieldTokensShardThresholdBytes > 0
      && fieldTokensShardMaxBytes > 0
      && fieldTokensEstimatedBytes >= fieldTokensShardThresholdBytes;
    if (fieldTokensUseShards) {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'field_tokens.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'field_tokens.json'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.json.gz'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.json.zst'), { policy: 'format_cleanup' });
        }
      );
      if (typeof log === 'function') {
        log(
          `field_tokens estimate ~${formatBytes(fieldTokensEstimatedBytes)}; ` +
          `using jsonl-sharded output (target ${formatBytes(fieldTokensShardMaxBytes)}).`
        );
      }
      enqueueJsonArraySharded('field_tokens', state.fieldTokens, {
        maxBytes: fieldTokensShardMaxBytes,
        estimatedBytes: fieldTokensEstimatedBytes,
        piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length },
        compression: null,
        gzipOptions: null,
        offsets: true
      });
    } else {
      enqueueWrite(
        formatArtifactLabel(path.join(outDir, 'field_tokens.parts')),
        async () => {
          await removeArtifact(path.join(outDir, 'field_tokens.meta.json'), { policy: 'format_cleanup' });
          await removeArtifact(path.join(outDir, 'field_tokens.parts'), {
            recursive: true,
            policy: 'format_cleanup'
          });
        }
      );
      enqueueJsonArray('field_tokens', state.fieldTokens, {
        piece: { type: 'postings', name: 'field_tokens', count: state.fieldTokens.length }
      });
    }
  }
  const fileRelationsCompression = resolveShardCompression('file_relations');
  const fileRelationsOrdering = enqueueFileRelationsArtifacts({
    state,
    outDir,
    maxJsonBytes: fileRelationsMaxBytes,
    byteBudget: fileRelationsBudget,
    log,
    compression: fileRelationsCompression,
    gzipOptions: fileRelationsCompression === 'gzip' ? compressionGzipOptions : null,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    stageCheckpoints
  });
  await recordOrdering('file_relations', fileRelationsOrdering, 'file_relations:file');
  const callSitesCompression = resolveShardCompression('call_sites');
  const riskStats = state?.riskInterproceduralStats || null;
  const riskConfig = riskStats?.effectiveConfig || null;
  const riskState = indexState?.riskInterprocedural || null;
  const emitArtifactsMode = riskInterproceduralEmitArtifacts
    || riskState?.emitArtifacts
    || riskConfig?.emitArtifacts
    || null;
  const allowCallSitesArtifacts = emitArtifactsMode !== 'none';
  const callSitesRequired = allowCallSitesArtifacts
    && riskState?.enabled === true
    && riskState?.summaryOnly !== true;
  const callSitesRef = allowCallSitesArtifacts
    ? enqueueCallSitesArtifacts({
      state,
      outDir,
      maxJsonBytes: callSitesMaxBytes,
      byteBudget: callSitesBudget,
      log,
      forceEmpty: callSitesRequired,
      compression: callSitesCompression,
      gzipOptions: callSitesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    })
    : null;
  const riskSummariesCompression = resolveShardCompression('risk_summaries');
  const riskFlowsCompression = resolveShardCompression('risk_flows');
  if (mode === 'code' && state?.riskInterproceduralStats) {
    enqueueRiskInterproceduralArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: riskSummariesCompression,
      flowsCompression: riskFlowsCompression,
      gzipOptions: compressionGzipOptions,
      emitArtifacts: riskInterproceduralEmitArtifacts || 'jsonl',
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      callSitesRef
    });
  }
  if (mode === 'code') {
    const symbolsCompression = resolveShardCompression('symbols');
    await enqueueSymbolsArtifacts({
      state,
      outDir,
      maxJsonBytes,
      log,
      compression: symbolsCompression,
      gzipOptions: symbolsCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
    const symbolOccurrencesCompression = resolveShardCompression('symbol_occurrences');
    await enqueueSymbolOccurrencesArtifacts({
      state,
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes: symbolOccurrencesMaxBytes,
      byteBudget: symbolOccurrencesBudget,
      log,
      format: symbolArtifactsFormatConfig,
      compression: symbolOccurrencesCompression,
      gzipOptions: symbolOccurrencesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
    const symbolEdgesCompression = resolveShardCompression('symbol_edges');
    await enqueueSymbolEdgesArtifacts({
      state,
      fileIdByPath,
      chunkUidToFileId,
      outDir,
      maxJsonBytes: symbolEdgesMaxBytes,
      byteBudget: symbolEdgesBudget,
      log,
      format: symbolArtifactsFormatConfig,
      compression: symbolEdgesCompression,
      gzipOptions: symbolEdgesCompression === 'gzip' ? compressionGzipOptions : null,
      enqueueWrite,
      addPieceFile,
      formatArtifactLabel,
      stageCheckpoints
    });
  }
  const scheduleRelations = scheduler?.schedule
    ? (fn) => scheduler.schedule(
      SCHEDULER_QUEUE_NAMES.stage2Relations,
      { cpu: 1, mem: 1 },
      fn
    )
    : (fn) => fn();
  const scheduleRelationsIo = scheduler?.schedule
    ? (fn) => scheduler.schedule(SCHEDULER_QUEUE_NAMES.stage2RelationsIo, { io: 1 }, fn)
    : (fn) => fn();
  const graphRelationsOrdering = await scheduleRelations(() => enqueueGraphRelationsArtifacts({
    graphRelations,
    chunks: state?.chunks || [],
    fileRelations: state?.fileRelations || null,
    caps: indexingConfig?.graph?.caps || null,
    outDir,
    maxJsonBytes: graphRelationsMaxBytes,
    byteBudget: graphRelationsBudget,
    log,
    scheduleIo: scheduleRelationsIo,
    enqueueWrite,
    addPieceFile,
    formatArtifactLabel,
    removeArtifact
  }));
  await recordOrdering('graph_relations', graphRelationsOrdering, 'graph_relations:graph,node');
  if (sparseArtifactsEnabled && resolvedConfig.enablePhraseNgrams !== false) {
    enqueueJsonObject('phrase_ngrams', {
      arrays: { vocab: postings.phraseVocab, postings: postings.phrasePostings }
    }, {
      piece: { type: 'postings', name: 'phrase_ngrams', count: postings.phraseVocab.length }
    });
    const phraseOrdering = measureVocabOrdering(postings.phraseVocab);
    await recordOrdering('phrase_ngrams', phraseOrdering, 'phrase_ngrams:ngram');
    if (phraseOrdering.orderingHash) {
      vocabOrder.phrase = {
        hash: phraseOrdering.orderingHash,
        count: phraseOrdering.orderingCount
      };
    }
  }
  if (sparseArtifactsEnabled && resolvedConfig.enableChargrams !== false) {
    enqueueJsonObject('chargram_postings', {
      fields: { hash: CHARGRAM_HASH_META },
      arrays: { vocab: postings.chargramVocab, postings: postings.chargramPostings }
    }, {
      piece: { type: 'postings', name: 'chargram_postings', count: postings.chargramVocab.length }
    });
    const chargramOrdering = measureVocabOrdering(postings.chargramVocab);
    await recordOrdering('chargram_postings', chargramOrdering, 'chargram_postings:gram');
    if (chargramOrdering.orderingHash) {
      vocabOrder.chargram = {
        hash: chargramOrdering.orderingHash,
        count: chargramOrdering.orderingCount
      };
    }
  }
  if (sparseArtifactsEnabled && Object.keys(vocabOrder).length) {
    enqueueJsonObject('vocab_order', {
      fields: {
        algo: 'sha1',
        generatedAt: new Date().toISOString(),
        vocab: vocabOrder
      }
    }, {
      piece: { type: 'postings', name: 'vocab_order' }
    });
  }
  const {
    ultraLight: ultraLightWrites,
    massive: massiveWrites,
    light: lightWrites,
    heavy: heavyWrites
  } = splitWriteLanes(writes);
  totalWrites = ultraLightWrites.length + massiveWrites.length + lightWrites.length + heavyWrites.length;
  if (totalWrites) {
    const artifactLabel = totalWrites === 1 ? 'artifact' : 'artifacts';
    logLine(`Writing index files (${totalWrites} ${artifactLabel})...`, { kind: 'status' });
    const { cap: writeConcurrencyCap, override: writeConcurrencyOverride } = resolveArtifactWriteConcurrency({
      artifactConfig,
      totalWrites
    });
    const writeConcurrency = Math.max(1, Math.min(totalWrites, writeConcurrencyCap));
    const adaptiveWriteInitialConcurrency = adaptiveWriteConcurrencyEnabled
      ? (
        adaptiveWriteStartConcurrencyOverride
        || (writeConcurrencyOverride
          ? writeConcurrency
          : Math.max(adaptiveWriteMinConcurrency, Math.ceil(writeConcurrency * 0.6)))
      )
      : writeConcurrency;
    const writeConcurrencyController = createAdaptiveWriteConcurrencyController({
      maxConcurrency: writeConcurrency,
      minConcurrency: adaptiveWriteMinConcurrency,
      initialConcurrency: adaptiveWriteInitialConcurrency,
      scaleUpBacklogPerSlot: adaptiveWriteScaleUpBacklogPerSlot,
      scaleDownBacklogPerSlot: adaptiveWriteScaleDownBacklogPerSlot,
      stallScaleDownSeconds: adaptiveWriteStallScaleDownSeconds,
      stallScaleUpGuardSeconds: adaptiveWriteStallScaleUpGuardSeconds,
      scaleUpCooldownMs: adaptiveWriteScaleUpCooldownMs,
      scaleDownCooldownMs: adaptiveWriteScaleDownCooldownMs,
      onChange: ({ reason, from, to, pendingWrites, longestStallSec }) => {
        const stallSuffix = longestStallSec > 0 ? `, stall=${longestStallSec}s` : '';
        logLine(
          `[perf] adaptive artifact write concurrency ${from} -> ${to} (${reason}, pending=${pendingWrites}${stallSuffix})`,
          { kind: 'status' }
        );
      }
    });
    const hostConcurrency = typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : (Array.isArray(os.cpus()) ? os.cpus().length : 1);
    const laneQueues = {
      ultraLight: ultraLightWrites.slice(),
      massive: massiveWrites.slice(),
      light: lightWrites.slice(),
      heavy: heavyWrites.slice()
    };
    const laneActive = {
      ultraLight: 0,
      massive: 0,
      light: 0,
      heavy: 0
    };
    let activeCount = 0;
    let fatalWriteError = null;
    const inFlightWrites = new Set();
    let forcedTailRescueConcurrency = null;
    let tailRescueActive = false;
    let tailWorkerActive = 0;
    const pendingWriteCount = () => (
      laneQueues.ultraLight.length
      + laneQueues.massive.length
      + laneQueues.light.length
      + laneQueues.heavy.length
    );
    const getActiveWriteConcurrency = () => (
      forcedTailRescueConcurrency != null
        ? Math.max(
          forcedTailRescueConcurrency,
          adaptiveWriteConcurrencyEnabled
            ? writeConcurrencyController.getCurrentConcurrency()
            : writeConcurrency
        )
        : (
          adaptiveWriteConcurrencyEnabled
            ? writeConcurrencyController.getCurrentConcurrency()
            : writeConcurrency
        )
    );
    const resolveTailRescueState = () => {
      const pendingWrites = pendingWriteCount();
      const remainingWrites = pendingWrites + activeCount;
      const longestStallSec = getLongestWriteStallSeconds();
      const active = writeTailRescueEnabled
        && remainingWrites > 0
        && remainingWrites <= writeTailRescueMaxPending
        && longestStallSec >= writeTailRescueStallSeconds;
      return {
        active,
        remainingWrites,
        longestStallSec
      };
    };
    const observeAdaptiveWriteConcurrency = () => {
      const rescueState = resolveTailRescueState();
      if (rescueState.active !== tailRescueActive) {
        tailRescueActive = rescueState.active;
        if (tailRescueActive) {
          logLine(
            `[perf] write tail rescue active: remaining=${rescueState.remainingWrites}, ` +
            `stall=${rescueState.longestStallSec}s, boost=+${writeTailRescueBoostIoTokens}io/+${writeTailRescueBoostMemTokens}mem`,
            { kind: 'warning' }
          );
        } else {
          logLine('[perf] write tail rescue cleared', { kind: 'status' });
        }
      }
      forcedTailRescueConcurrency = rescueState.active ? writeConcurrency : null;
      if (!adaptiveWriteConcurrencyEnabled) return getActiveWriteConcurrency();
      return writeConcurrencyController.observe({
        pendingWrites: pendingWriteCount(),
        activeWrites: activeCount,
        longestStallSec: rescueState.longestStallSec
      });
    };
    const resolveLaneBudgets = () => {
      const ultraLightWritesTotal = laneQueues.ultraLight.length + laneActive.ultraLight;
      const lightWritesTotal = laneQueues.light.length + laneActive.light;
      const mediumWritesTotal = laneQueues.heavy.length + laneActive.heavy;
      const largeWritesTotal = laneQueues.massive.length + laneActive.massive;
      const workClass = resolveArtifactWorkClassConcurrency({
        writeConcurrency: getActiveWriteConcurrency(),
        smallWrites: ultraLightWritesTotal + lightWritesTotal,
        mediumWrites: mediumWritesTotal,
        largeWrites: largeWritesTotal,
        smallConcurrencyOverride: workClassSmallConcurrencyOverride,
        mediumConcurrencyOverride: workClassMediumConcurrencyOverride,
        largeConcurrencyOverride: workClassLargeConcurrencyOverride,
        hostConcurrency
      });
      const smallBudget = Math.max(0, workClass.smallConcurrency);
      let ultraLightConcurrency = 0;
      let lightConcurrency = 0;
      if (smallBudget > 0) {
        if (ultraLightWritesTotal > 0) {
          const ultraReserve = Math.max(1, Math.min(2, smallBudget));
          ultraLightConcurrency = Math.min(ultraLightWritesTotal, ultraReserve);
        }
        const remainingAfterUltra = Math.max(0, smallBudget - ultraLightConcurrency);
        lightConcurrency = Math.min(lightWritesTotal, remainingAfterUltra);
        let remainingAfterLight = Math.max(0, smallBudget - ultraLightConcurrency - lightConcurrency);
        if (remainingAfterLight > 0 && lightWritesTotal > lightConcurrency) {
          const growLight = Math.min(remainingAfterLight, lightWritesTotal - lightConcurrency);
          lightConcurrency += growLight;
          remainingAfterLight -= growLight;
        }
        if (remainingAfterLight > 0 && ultraLightWritesTotal > ultraLightConcurrency) {
          ultraLightConcurrency += Math.min(remainingAfterLight, ultraLightWritesTotal - ultraLightConcurrency);
        }
      }
      return {
        ultraLightConcurrency,
        massiveConcurrency: workClass.largeConcurrency,
        lightConcurrency,
        heavyConcurrency: workClass.mediumConcurrency,
        workClass
      };
    };
    const pickDispatchLane = (budgets) => {
      const ultraLightAvailable = laneQueues.ultraLight.length > 0
        && laneActive.ultraLight < Math.max(0, budgets.ultraLightConcurrency);
      const massiveAvailable = laneQueues.massive.length > 0
        && laneActive.massive < Math.max(0, budgets.massiveConcurrency);
      const lightAvailable = laneQueues.light.length > 0
        && laneActive.light < Math.max(0, budgets.lightConcurrency);
      const heavyAvailable = laneQueues.heavy.length > 0
        && laneActive.heavy < Math.max(0, budgets.heavyConcurrency);
      if (ultraLightAvailable) return 'ultraLight';
      if (massiveAvailable) return 'massive';
      if (heavyAvailable) return 'heavy';
      if (lightAvailable) return 'light';
      return null;
    };
    const takeLaneDispatchEntries = (laneName) => {
      const queue = Array.isArray(laneQueues?.[laneName]) ? laneQueues[laneName] : null;
      if (!queue || !queue.length) return [];
      if (laneName === 'ultraLight' && writeFsStrategy.microCoalescing) {
        const batch = selectMicroWriteBatch(queue, {
          maxEntries: writeFsStrategy.microBatchMaxCount,
          maxBytes: writeFsStrategy.microBatchMaxBytes,
          maxEntryBytes: ultraLightWriteThresholdBytes
        });
        return Array.isArray(batch?.entries) ? batch.entries.filter(Boolean) : [];
      }
      const entry = queue.shift();
      return entry ? [entry] : [];
    };
    const resolveWriteSchedulerTokens = (estimatedBytes, laneName, rescueBoost = false) => {
      const memTokens = resolveArtifactWriteMemTokens(estimatedBytes);
      if (laneName === 'massive') {
        const massiveMem = Math.max(memTokens, massiveWriteMemTokens);
        const ioTokens = massiveWriteIoTokens + (rescueBoost ? writeTailRescueBoostIoTokens : 0);
        const memBudget = massiveMem + (rescueBoost ? writeTailRescueBoostMemTokens : 0);
        return memBudget > 0
          ? { io: ioTokens, mem: memBudget }
          : { io: ioTokens };
      }
      const ioTokens = 1 + (rescueBoost ? writeTailRescueBoostIoTokens : 0);
      const memBudget = memTokens + (rescueBoost ? writeTailRescueBoostMemTokens : 0);
      return memBudget > 0 ? { io: ioTokens, mem: memBudget } : { io: ioTokens };
    };
    const scheduleWriteJob = (fn, tokens) => {
      if (!scheduler?.schedule || typeof fn !== 'function') return fn();
      return scheduler.schedule(
        SCHEDULER_QUEUE_NAMES.stage2Write,
        tokens,
        fn
      );
    };
    const runSingleWrite = async (
      { label, job, estimatedBytes, enqueuedAt, prefetched, prefetchStartedAt },
      laneName,
      { rescueBoost = false, tailWorker = false, batchSize = 1, batchIndex = 0 } = {}
    ) => {
      const activeLabel = label || '(unnamed artifact)';
      const dispatchStartedAt = Date.now();
      const started = resolveWriteStartTimestampMs(prefetchStartedAt, dispatchStartedAt);
      const queueDelayMs = Math.max(0, started - (Number(enqueuedAt) || started));
      const startedConcurrency = getActiveWriteConcurrency();
      activeWrites.set(activeLabel, started);
      activeWriteBytes.set(activeLabel, Number.isFinite(estimatedBytes) ? estimatedBytes : 0);
      updateWriteInFlightTelemetry();
      try {
        const schedulerTokens = resolveWriteSchedulerTokens(estimatedBytes, laneName, rescueBoost);
        const writeResult = prefetched
          ? await prefetched
          : await scheduleWriteJob(job, schedulerTokens);
        const durationMs = Math.max(0, Date.now() - started);
        const serializationMs = Number.isFinite(Number(writeResult?.serializationMs))
          ? Math.max(0, Number(writeResult.serializationMs))
          : null;
        const diskMs = Number.isFinite(Number(writeResult?.diskMs))
          ? Math.max(0, Number(writeResult.diskMs))
          : (serializationMs != null ? Math.max(0, durationMs - serializationMs) : null);
        let bytes = null;
        if (Number.isFinite(Number(writeResult?.bytes))) {
          bytes = Number(writeResult.bytes);
        }
        if (!Number.isFinite(bytes) && label) {
          try {
            const stat = await fs.stat(path.join(outDir, label));
            bytes = stat.size;
          } catch {}
        }
        const throughputBytesPerSec = Number.isFinite(bytes) && durationMs > 0
          ? Math.round(bytes / (durationMs / 1000))
          : null;
        const latencyClass = resolveArtifactWriteLatencyClass({
          queueDelayMs,
          durationMs,
          bytes,
          estimatedBytes
        });
        recordArtifactMetric(label, {
          queueDelayMs,
          waitMs: queueDelayMs,
          durationMs,
          bytes,
          estimatedBytes: Number.isFinite(estimatedBytes) ? estimatedBytes : null,
          throughputBytesPerSec,
          serializationMs,
          diskMs,
          directFdStreaming: writeResult?.directFdStreaming === true,
          tailRescueBoosted: rescueBoost === true,
          tailWorker: tailWorker === true,
          batchSize: batchSize > 1 ? batchSize : null,
          batchIndex: batchSize > 1 ? batchIndex + 1 : null,
          latencyClass,
          fsStrategyMode: writeFsStrategy.mode,
          checksum: typeof writeResult?.checksum === 'string' ? writeResult.checksum : null,
          checksumAlgo: typeof writeResult?.checksumAlgo === 'string' ? writeResult.checksumAlgo : null,
          lane: laneName,
          schedulerIoTokens: schedulerTokens.io || 0,
          schedulerMemTokens: schedulerTokens.mem || 0,
          writeConcurrencyAtStart: startedConcurrency
        });
        updatePieceMetadata(label, {
          bytes,
          checksum: typeof writeResult?.checksum === 'string' ? writeResult.checksum : null,
          checksumAlgo: typeof writeResult?.checksumAlgo === 'string' ? writeResult.checksumAlgo : null,
          checksumHash: typeof writeResult?.checksumHash === 'string' ? writeResult.checksumHash : null
        });
      } finally {
        activeWrites.delete(activeLabel);
        activeWriteBytes.delete(activeLabel);
        updateWriteInFlightTelemetry();
        writeStallAlerts.delete(activeLabel);
        logWriteProgress(label);
      }
    };
    const runWriteBatch = async (entries, laneName, options = {}) => {
      const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
      if (!list.length) return;
      if (list.length === 1) {
        await runSingleWrite(list[0], laneName, options);
        return;
      }
      for (let index = 0; index < list.length; index += 1) {
        await runSingleWrite(list[index], laneName, {
          ...options,
          batchSize: list.length,
          batchIndex: index
        });
      }
    };
    const dispatchWrites = () => {
      observeAdaptiveWriteConcurrency();
      while (!fatalWriteError) {
        const activeConcurrency = getActiveWriteConcurrency();
        const remainingWrites = pendingWriteCount() + activeCount;
        const tailWorkerEligible = writeTailWorkerEnabled
          && tailWorkerActive < 1
          && remainingWrites > 0
          && remainingWrites <= writeTailWorkerMaxPending;
        const concurrencyLimit = activeConcurrency + (tailWorkerEligible ? 1 : 0);
        if (activeCount >= concurrencyLimit) break;
        const rescueState = resolveTailRescueState();
        const budgets = resolveLaneBudgets();
        let laneName = pickDispatchLane(budgets);
        let dispatchEntries = laneName ? takeLaneDispatchEntries(laneName) : [];
        let usedTailWorker = false;
        if (
          (!laneName || dispatchEntries.length === 0)
          && tailWorkerEligible
          && activeCount >= activeConcurrency
        ) {
          const tailSelection = selectTailWorkerWriteEntry(laneQueues, {
            laneOrder: ['massive', 'heavy', 'light', 'ultraLight']
          });
          if (tailSelection?.entry) {
            laneName = tailSelection.laneName;
            dispatchEntries = [tailSelection.entry];
            usedTailWorker = true;
          }
        }
        if (!laneName || dispatchEntries.length === 0) break;
        if (usedTailWorker) {
          tailWorkerActive += 1;
        } else {
          laneActive[laneName] += 1;
        }
        activeCount += 1;
        const tracked = runWriteBatch(
          dispatchEntries,
          laneName,
          {
            rescueBoost: rescueState.active && laneName !== 'ultraLight',
            tailWorker: usedTailWorker
          }
        )
          .then(() => ({ ok: true }))
          .catch((error) => ({ ok: false, error }))
          .finally(() => {
            if (usedTailWorker) {
              tailWorkerActive = Math.max(0, tailWorkerActive - 1);
            } else {
              laneActive[laneName] = Math.max(0, laneActive[laneName] - 1);
            }
            activeCount = Math.max(0, activeCount - 1);
          });
        inFlightWrites.add(tracked);
        tracked
          .finally(() => {
            inFlightWrites.delete(tracked);
          })
          .catch(() => {});
      }
    };
    startWriteHeartbeat();
    try {
      dispatchWrites();
      while (
        inFlightWrites.size > 0
        || laneQueues.ultraLight.length > 0
        || laneQueues.massive.length > 0
        || laneQueues.light.length > 0
        || laneQueues.heavy.length > 0
      ) {
        if (fatalWriteError) break;
        if (!inFlightWrites.size) {
          dispatchWrites();
          if (!inFlightWrites.size) break;
        }
        const settled = await Promise.race(inFlightWrites);
        if (!settled?.ok) {
          fatalWriteError = settled?.error || new Error('artifact write failed');
          break;
        }
        dispatchWrites();
      }
      if (fatalWriteError) {
        throw fatalWriteError;
      }
    } finally {
      stopWriteHeartbeat();
      activeWriteBytes.clear();
      updateWriteInFlightTelemetry();
    }
    logLine('', { kind: 'status' });
  } else {
    logLine('Writing index files (0 artifacts)...', { kind: 'status' });
    logLine('', { kind: 'status' });
  }
  if (vectorOnlyProfile) {
    const deniedPieces = pieceEntries
      .filter((entry) => VECTOR_ONLY_SPARSE_PIECE_DENYLIST.has(String(entry?.name || '')))
      .map((entry) => String(entry?.name || '').trim())
      .filter(Boolean);
    if (deniedPieces.length) {
      const uniqueDenied = Array.from(new Set(deniedPieces)).sort((a, b) => a.localeCompare(b));
      throw new Error(
        `[vector_only] sparse artifact emission detected: ${uniqueDenied.join(', ')}. ` +
        'Rebuild with sparse outputs disabled.'
      );
    }
    const lingeringSparse = getLingeringSparseArtifacts(outDir);
    if (lingeringSparse.length) {
      const sample = lingeringSparse.sort((a, b) => a.localeCompare(b)).slice(0, 8).join(', ');
      throw new Error(
        `[vector_only] sparse artifacts still present after cleanup: ${sample}. ` +
        'Delete stale sparse artifacts and rebuild.'
      );
    }
  }
  timing.writeMs = Date.now() - writeStart;
  timing.totalMs = Date.now() - timing.start;
  log(
    `📦  ${mode.padEnd(5)}: ${state.chunks.length.toLocaleString()} chunks, ${postings.tokenVocab.length.toLocaleString()} tokens, dims=${postings.dims}`
  );
  if (filterIndexStats && typeof filterIndexStats === 'object') {
    const filterIndexPiece = pieceEntries.find((entry) => entry?.name === 'filter_index' && entry?.path);
    const filterIndexPath = filterIndexPiece?.path ? path.join(outDir, filterIndexPiece.path) : null;
    let filterIndexDiskBytes = null;
    if (filterIndexPiece?.path) {
      const metric = artifactMetrics.get(filterIndexPiece.path);
      if (Number.isFinite(metric?.bytes)) filterIndexDiskBytes = metric.bytes;
    }
    if (!Number.isFinite(filterIndexDiskBytes) && filterIndexPath) {
      try {
        const stat = await fs.stat(filterIndexPath);
        filterIndexDiskBytes = stat.size;
      } catch {}
    }
    if (Number.isFinite(filterIndexDiskBytes)) {
      filterIndexStats.diskBytes = filterIndexDiskBytes;
    }
    if (
      Number.isFinite(filterIndexDiskBytes)
      && Number.isFinite(filterIndexStats.jsonBytes)
      && filterIndexStats.jsonBytes > 0
    ) {
      filterIndexStats.compressionRatio = filterIndexDiskBytes / filterIndexStats.jsonBytes;
    }
  }

  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path) || { path: entry.path };
    if (Number.isFinite(entry.count)) metric.count = entry.count;
    if (Number.isFinite(entry.dims)) metric.dims = entry.dims;
    if (entry.compression) metric.compression = entry.compression;
    if (Number.isFinite(entry.bytes) && entry.bytes >= 0) metric.bytes = entry.bytes;
    if (typeof entry.checksum === 'string' && entry.checksum.includes(':')) {
      const [checksumAlgo, checksum] = entry.checksum.split(':');
      if (checksumAlgo && checksum) {
        metric.checksumAlgo = checksumAlgo;
        metric.checksum = checksum;
      }
    }
    artifactMetrics.set(entry.path, metric);
  }
  for (const entry of pieceEntries) {
    if (!entry?.path) continue;
    const metric = artifactMetrics.get(entry.path);
    if (!metric || typeof metric !== 'object') continue;
    if (!Number.isFinite(entry.bytes) && Number.isFinite(metric.bytes)) {
      entry.bytes = metric.bytes;
    }
    if (
      typeof entry.checksum !== 'string'
      && typeof metric.checksumAlgo === 'string'
      && typeof metric.checksum === 'string'
      && metric.checksumAlgo
      && metric.checksum
    ) {
      entry.checksum = `${metric.checksumAlgo}:${metric.checksum}`;
    }
  }
  if (timing) {
    const artifactLatencyClasses = summarizeArtifactLatencyClasses(Array.from(artifactMetrics.values()));
    timing.cleanup = {
      profileId,
      actions: cleanupActions,
      writeFsStrategy,
      artifactLatencyClasses
    };
    timing.artifacts = Array.from(artifactMetrics.values()).sort((a, b) => {
      const aPath = String(a?.path || '');
      const bPath = String(b?.path || '');
      return aPath.localeCompare(bPath);
    });
  }

  pieceEntries.sort((a, b) => {
    const pathA = String(a?.path || '');
    const pathB = String(b?.path || '');
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    const typeA = String(a?.type || '');
    const typeB = String(b?.type || '');
    if (typeA !== typeB) return typeA.localeCompare(typeB);
    const nameA = String(a?.name || '');
    const nameB = String(b?.name || '');
    return nameA.localeCompare(nameB);
  });
  await writePiecesManifest({
    pieceEntries,
    outDir,
    mode,
    indexState
  });
  await writeIndexMetrics({
    root,
    userConfig,
    mode,
    outDir,
    state,
    postings,
    dictSummary,
    useStubEmbeddings,
    modelId,
    denseVectorsEnabled,
    incrementalEnabled,
    fileCounts,
    timing,
    perfProfile,
    indexState,
    filterIndexStats,
    resolvedTokenMode,
    tokenSampleSize,
    tokenMaxFiles,
    chunkMetaUseJsonl: chunkMetaPlan.chunkMetaUseJsonl,
    chunkMetaUseShards: chunkMetaPlan.chunkMetaUseShards,
    tokenPostingsUseShards,
    compressionEnabled,
    compressionMode,
    compressionKeepRaw,
    documentExtractionEnabled,
    repoProvenance
  });
}
