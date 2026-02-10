#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import { createEmbedder } from '../../../src/index/embedding.js';
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

const texts = Array.from({ length: textCount }, (_, i) => `t${i}`);

const runProvider = async (provider) => {
  const normalized = String(provider).trim().toLowerCase();
  const useStubEmbeddings = normalized === 'stub';

  const embedder = createEmbedder({
    rootDir: process.cwd(),
    useStubEmbeddings,
    modelId: useStubEmbeddings ? 'stub' : (normalized || 'unknown'),
    dims,
    provider: normalized === 'onnx' ? 'onnx' : 'openai',
    // Provider-specific config is intentionally omitted for benches:
    // - openai requires API token
    // - onnx requires local model files
    // If unavailable, createEmbedder may throw; we surface a skip message.
    onnx: null,
    normalize: true
  });

  const embed = embedder.getChunkEmbeddings;

  for (const batchSize of batchList) {
    const start = performance.now();
    await runBatched({ texts, batchSize, embed });
    const durationMs = performance.now() - start;
    const throughput = texts.length ? (texts.length / (durationMs / 1000)) : 0;
    console.log(
      `[bench] provider=${normalized} batch=${batchSize} texts=${texts.length} dims=${dims} `
      + `duration=${durationMs.toFixed(1)}ms throughput=${throughput.toFixed(1)}/s`
    );
  }
};

for (const provider of providerList) {
  try {
    await runProvider(provider);
  } catch (err) {
    const label = String(provider).trim().toLowerCase() || 'unknown';
    const message = err?.message || String(err);
    console.warn(`[bench] provider=${label} skipped: ${message}`);
  }
}

