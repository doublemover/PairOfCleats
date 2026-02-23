import { getEnvConfig } from '../../shared/env.js';

const DYNAMIC_BUNDLE_TARGET_MS = 500;
const BUNDLE_SIZING_P95_WINDOW = 32;
const PROPAGATION_PARALLEL_MIN_BUNDLE = 96;

const parsePositiveInteger = (value, fallback) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.floor(numeric));
};

export const createBundleSizing = ({
  chunkCount,
  largeRepoBudget
}) => ({
  enabled: chunkCount >= 256,
  minBundleSize: largeRepoBudget ? 16 : 8,
  maxBundleSize: largeRepoBudget ? 256 : 128,
  initialBundleSize: largeRepoBudget ? 96 : 64,
  targetBundleMs: DYNAMIC_BUNDLE_TARGET_MS,
  totalBundles: 0,
  lastBundleSize: 0,
  avgBundleMs: 0,
  p95BundleMs: 0,
  recentWindowSize: BUNDLE_SIZING_P95_WINDOW,
  recentBundleDurationsMs: [],
  p95HeapDeltaBytes: 0,
  recentHeapDeltaBytes: []
});

export const resolvePropagationParallelOptions = () => {
  const envConfig = getEnvConfig(process.env);
  const envPropagationParallel = envConfig.crossfilePropagationParallel;
  return {
    propagationParallelEnabled: envPropagationParallel !== false,
    propagationParallelMinBundle: parsePositiveInteger(
      envConfig.crossfilePropagationParallelMinBundle,
      PROPAGATION_PARALLEL_MIN_BUNDLE
    )
  };
};

export const updateBundleSizing = ({
  bundleSizing,
  bundleLength,
  bundleDurationMs,
  heapDelta,
  currentBundleSize,
  log = () => {}
}) => {
  const recentDurations = bundleSizing.recentBundleDurationsMs;
  recentDurations.push(bundleDurationMs);
  while (recentDurations.length > bundleSizing.recentWindowSize) recentDurations.shift();
  if (recentDurations.length) {
    const sorted = recentDurations.slice().sort((a, b) => a - b);
    const p95Index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
    );
    bundleSizing.p95BundleMs = sorted[p95Index];
  }

  const recentHeapDeltas = bundleSizing.recentHeapDeltaBytes;
  recentHeapDeltas.push(heapDelta);
  while (recentHeapDeltas.length > bundleSizing.recentWindowSize) recentHeapDeltas.shift();
  if (recentHeapDeltas.length) {
    const sortedHeap = recentHeapDeltas.slice().sort((a, b) => a - b);
    const heapP95Index = Math.min(
      sortedHeap.length - 1,
      Math.max(0, Math.ceil(sortedHeap.length * 0.95) - 1)
    );
    bundleSizing.p95HeapDeltaBytes = sortedHeap[heapP95Index];
  }

  bundleSizing.totalBundles += 1;
  bundleSizing.lastBundleSize = bundleLength;
  bundleSizing.avgBundleMs = bundleSizing.totalBundles === 1
    ? bundleDurationMs
    : (
      ((bundleSizing.avgBundleMs * (bundleSizing.totalBundles - 1)) + bundleDurationMs)
      / bundleSizing.totalBundles
    );

  let nextBundleSize = currentBundleSize;
  if (bundleSizing.enabled) {
    const controlDurationMs = bundleSizing.p95BundleMs > 0
      ? bundleSizing.p95BundleMs
      : bundleDurationMs;
    if (controlDurationMs > bundleSizing.targetBundleMs && nextBundleSize > bundleSizing.minBundleSize) {
      nextBundleSize = Math.max(
        bundleSizing.minBundleSize,
        Math.floor(nextBundleSize * 0.75)
      );
    } else if (
      controlDurationMs < (bundleSizing.targetBundleMs * 0.5)
      && nextBundleSize < bundleSizing.maxBundleSize
    ) {
      nextBundleSize = Math.min(
        bundleSizing.maxBundleSize,
        Math.ceil(nextBundleSize * 1.25)
      );
    }

    if (
      typeof log === 'function'
      && (bundleSizing.totalBundles === 1 || (bundleSizing.totalBundles % 20) === 0)
    ) {
      log(
        `[perf] cross-file bundle ${bundleSizing.totalBundles}: `
        + `size=${bundleLength}, durationMs=${bundleDurationMs}, p95Ms=${bundleSizing.p95BundleMs}, `
        + `heapDeltaBytes=${heapDelta}, p95HeapDeltaBytes=${bundleSizing.p95HeapDeltaBytes}, `
        + `nextSize=${nextBundleSize}.`
      );
    }
  }

  return nextBundleSize;
};
