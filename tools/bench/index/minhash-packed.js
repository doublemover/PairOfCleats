import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';
import { loadMinhashSignatures } from '../../../src/shared/artifact-io/loaders.js';

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

const createRng = (seed) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const args = parseArgs();
const count = Number(args.count) || 10000;
const dims = Number(args.dims) || 64;
const seed = Number(args.seed) || 2024;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const benchRoot = args.root
  ? path.resolve(String(args.root))
  : path.join(process.cwd(), '.benchCache', 'minhash-packed');

const buildSignatures = () => {
  const rng = createRng(seed);
  const signatures = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const sig = new Array(dims);
    for (let j = 0; j < dims; j += 1) {
      sig[j] = Math.floor(rng() * 0xffffffff) >>> 0;
    }
    signatures[i] = sig;
  }
  return signatures;
};

const packSignatures = (signatures) => {
  if (!Array.isArray(signatures) || !signatures.length) return null;
  const total = signatures.length * dims;
  const buffer = Buffer.allocUnsafe(total * 4);
  const view = new Uint32Array(buffer.buffer, buffer.byteOffset, total);
  let offset = 0;
  for (const sig of signatures) {
    if (!Array.isArray(sig) || sig.length !== dims) return null;
    for (let i = 0; i < dims; i += 1) {
      const value = sig[i];
      view[offset] = Number.isFinite(value) ? value : 0;
      offset += 1;
    }
  }
  return buffer;
};

const toManifestPath = (value) => String(value || '').replace(/\\/g, '/');

const writePiecesManifest = async (runRoot, pieces) => {
  const manifestPath = path.join(runRoot, 'pieces', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await writeJsonObjectFile(manifestPath, {
    fields: {
      compatibilityKey: 'bench-minhash-packed',
      pieces: Array.isArray(pieces)
        ? pieces.map((piece) => ({
          ...piece,
          path: toManifestPath(piece?.path)
        }))
        : []
    },
    atomic: true
  });
};

const runBaseline = async (runRoot, signatures) => {
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const jsonPath = path.join(runRoot, 'minhash_signatures.json');
  await writeJsonObjectFile(jsonPath, { arrays: { signatures } });
  await writePiecesManifest(runRoot, [
    { name: 'minhash_signatures', path: 'minhash_signatures.json', format: 'json' }
  ]);
  const stat = await fs.stat(jsonPath);
  const start = performance.now();
  const loaded = await loadMinhashSignatures(runRoot, { strict: false });
  const totalMs = performance.now() - start;
  return { bytes: stat.size, totalMs, loadedCount: loaded.signatures?.length || 0 };
};

const runCurrent = async (runRoot, signatures) => {
  await fs.rm(runRoot, { recursive: true, force: true });
  await fs.mkdir(runRoot, { recursive: true });
  const packed = packSignatures(signatures);
  if (!packed) {
    throw new Error('Failed to pack signatures.');
  }
  const packedPath = path.join(runRoot, 'minhash_signatures.packed.bin');
  const packedMetaPath = path.join(runRoot, 'minhash_signatures.packed.meta.json');
  await fs.writeFile(packedPath, packed);
  await writeJsonObjectFile(packedMetaPath, {
    fields: {
      format: 'u32',
      endian: 'le',
      dims,
      count
    },
    atomic: true
  });
  await writePiecesManifest(runRoot, [
    { name: 'minhash_signatures', path: 'minhash_signatures.packed.bin', format: 'packed' },
    { name: 'minhash_signatures_meta', path: 'minhash_signatures.packed.meta.json', format: 'json' }
  ]);
  const stat = await fs.stat(packedPath);
  const start = performance.now();
  const loaded = await loadMinhashSignatures(runRoot, { strict: false });
  const totalMs = performance.now() - start;
  return { bytes: stat.size, totalMs, loadedCount: loaded.signatures?.length || 0 };
};

const signatures = buildSignatures();
let baseline = null;
let current = null;
if (mode !== 'current') {
  baseline = await runBaseline(path.join(benchRoot, 'baseline'), signatures);
  const throughput = count / (baseline.totalMs / 1000);
  console.log(
    `[bench] baseline count=${count} dims=${dims} bytes=${baseline.bytes} load=${baseline.totalMs.toFixed(
      1
    )}ms throughput=${throughput.toFixed(1)}/s`
  );
}
if (mode !== 'baseline') {
  current = await runCurrent(path.join(benchRoot, 'current'), signatures);
  const throughput = count / (current.totalMs / 1000);
  const parts = [
    `count=${count}`,
    `dims=${dims}`,
    `bytes=${current.bytes}`,
    `load=${current.totalMs.toFixed(1)}ms`,
    `throughput=${throughput.toFixed(1)}/s`
  ];
  if (baseline) {
    const deltaMs = current.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (deltaMs / baseline.totalMs) * 100 : 0;
    const baseThroughput = count / (baseline.totalMs / 1000);
    const deltaThroughput = throughput - baseThroughput;
    parts.push(`delta=${deltaMs.toFixed(1)}ms (${pct.toFixed(1)}%)`);
    parts.push(`throughputΔ=${deltaThroughput.toFixed(1)}/s`);
    parts.push(`bytesΔ=${current.bytes - baseline.bytes}`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
  if (baseline) {
    const deltaMs = current.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (deltaMs / baseline.totalMs) * 100 : 0;
    const baseThroughput = count / (baseline.totalMs / 1000);
    const deltaThroughput = throughput - baseThroughput;
    console.log(
      `[bench] delta ms=${deltaMs.toFixed(1)} (${pct.toFixed(1)}%) throughput=${throughput.toFixed(
        1
      )}/s Δ=${deltaThroughput.toFixed(1)}/s bytes=${current.bytes - baseline.bytes}`
    );
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  count,
  dims,
  baseline,
  current
};
console.log(JSON.stringify(summary, null, 2));
