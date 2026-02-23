#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { createEmbedder } from '../../../src/index/embedding.js';
import { createToolDisplay } from '../../shared/cli-display.js';
import { runBatched } from '../../build/embeddings/embed.js';

const parseArgs = () => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
};

const args = parseArgs();
const display = createToolDisplay({ argv: args, stream: process.stderr });
const providerList = String(args.providers || 'stub')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const batchList = String(args.batches || '16,32,64,128')
  .split(',')
  .map((value) => Math.max(1, Math.floor(Number(value))))
  .filter((value) => Number.isFinite(value) && value > 0);
const textCount = Math.max(1, Math.floor(Number(args.texts || 2000)));
const dims = Math.max(1, Math.floor(Number(args.dims || 384)));
const stubBatchMsRaw = Number(args['stub-batch-ms']);
const stubBatchMs = Number.isFinite(stubBatchMsRaw) && stubBatchMsRaw > 0
  ? stubBatchMsRaw
  : null;

const texts = Array.from({ length: textCount }, (_, i) => `t${i}`);
const providerTask = display.task('Providers', {
  taskId: 'embedding-throughput:providers',
  total: providerList.length,
  stage: 'bench'
});
let providersCompleted = 0;

const formatElapsed = (startedAtMs) => {
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  if (elapsedMs < 1000) return `${elapsedMs}ms`;
  return `${(elapsedMs / 1000).toFixed(1)}s`;
};

const resolveProviderModel = (value) => {
  const raw = String(value || '').trim();
  const normalized = raw.toLowerCase();
  if (!raw || normalized === 'stub') {
    return {
      label: 'stub',
      provider: 'xenova',
      modelId: 'stub',
      useStubEmbeddings: true
    };
  }
  if (raw.startsWith('onnx:')) {
    return {
      label: raw,
      provider: 'onnx',
      modelId: raw.slice('onnx:'.length).trim() || 'Xenova/bge-small-en-v1.5',
      useStubEmbeddings: false
    };
  }
  if (raw.startsWith('xenova:')) {
    return {
      label: raw,
      provider: 'xenova',
      modelId: raw.slice('xenova:'.length).trim() || 'Xenova/bge-small-en-v1.5',
      useStubEmbeddings: false
    };
  }
  if (normalized === 'onnx') {
    return {
      label: 'onnx',
      provider: 'onnx',
      modelId: 'Xenova/bge-small-en-v1.5',
      useStubEmbeddings: false
    };
  }
  if (normalized === 'xenova') {
    return {
      label: 'xenova',
      provider: 'xenova',
      modelId: 'Xenova/bge-small-en-v1.5',
      useStubEmbeddings: false
    };
  }
  return {
    label: raw,
    provider: 'xenova',
    modelId: raw,
    useStubEmbeddings: false
  };
};

const runProvider = async (provider) => {
  const providerModel = resolveProviderModel(provider);
  const normalized = providerModel.label.toLowerCase();
  const useStubEmbeddings = providerModel.useStubEmbeddings === true;

  const embedder = createEmbedder({
    rootDir: process.cwd(),
    useStubEmbeddings,
    modelId: providerModel.modelId,
    dims,
    provider: providerModel.provider,
    // Provider-specific config is intentionally omitted for benches:
    // - openai requires API token
    // - onnx requires local model files
    // If unavailable, createEmbedder may throw; we surface a skip message.
    onnx: null,
    normalize: true
  });

  const embed = embedder.getChunkEmbeddings;
  const batchTask = display.task(`Batches ${normalized || 'unknown'}`, {
    taskId: `embedding-throughput:batches:${normalized || 'unknown'}`,
    total: batchList.length,
    stage: 'bench',
    mode: normalized || 'unknown',
    ephemeral: true
  });
  let completedBatches = 0;

  const warmupStartAtMs = Date.now();
  batchTask.set(completedBatches, batchList.length, {
    message: `warmup (${formatElapsed(warmupStartAtMs)})`
  });
  await embed([texts[0] || 'warmup']);
  display.log(
    `[bench] provider=${normalized} model=${providerModel.modelId} warmup completed in ${formatElapsed(warmupStartAtMs)}`,
    { kind: 'status', stage: 'bench' }
  );

  try {
    for (const batchSize of batchList) {
      const phaseStartAtMs = Date.now();
      batchTask.set(completedBatches, batchList.length, {
        message: `batch=${batchSize} running (${formatElapsed(phaseStartAtMs)})`
      });
      const start = performance.now();
      let lastInnerUpdate = 0;
      let embedCalls = 0;
      await runBatched({
        texts,
        batchSize,
        embed: async (batch) => {
          embedCalls += 1;
          return embed(batch);
        },
        onBatch: ({ completed, total, batchIndex, batchCount }) => {
          const now = Date.now();
          if ((now - lastInnerUpdate) < 150) return;
          lastInnerUpdate = now;
          batchTask.set(completedBatches, batchList.length, {
            message: `batch=${batchSize} ${completed}/${total} texts (${batchIndex}/${batchCount})`
          });
        }
      });
      const measuredDurationMs = performance.now() - start;
      // Deterministic stub timing keeps CI KPI checks stable while still using
      // the benchmark's existing throughput output format.
      const durationMs = (
        useStubEmbeddings && Number.isFinite(stubBatchMs)
          ? (embedCalls * stubBatchMs)
          : measuredDurationMs
      );
      const throughput = texts.length ? (texts.length / (durationMs / 1000)) : 0;
      completedBatches += 1;
      batchTask.set(completedBatches, batchList.length, {
        message: `batch=${batchSize} done ${durationMs.toFixed(1)}ms @ ${throughput.toFixed(1)}/s`
      });
      console.log(
        `[bench] provider=${providerModel.provider} model=${providerModel.modelId} `
        + `batch=${batchSize} texts=${texts.length} dims=${dims} `
        + `duration=${durationMs.toFixed(1)}ms throughput=${throughput.toFixed(1)}/s `
        + `calls=${embedCalls} timing=${Number.isFinite(stubBatchMs) && useStubEmbeddings ? 'stub-fixed' : 'wall'}`
      );
    }
  } finally {
    batchTask.done({ message: 'batch sweep complete' });
  }
};

for (const provider of providerList) {
  try {
    await runProvider(provider);
    providersCompleted += 1;
    providerTask.set(providersCompleted, providerList.length, {
      message: `${provider} complete`
    });
  } catch (err) {
    const label = String(provider).trim().toLowerCase() || 'unknown';
    const message = err?.message || String(err);
    console.warn(`[bench] provider=${label} skipped: ${message}`);
    providersCompleted += 1;
    providerTask.set(providersCompleted, providerList.length, {
      message: `${label} skipped`
    });
  }
}

providerTask.done({ message: 'throughput sweep complete' });
display.flush();
display.close();

