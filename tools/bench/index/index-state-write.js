import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { sha1 } from '../../../src/shared/hash.js';
import { stableStringifyForSignature } from '../../../src/shared/stable-json.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream.js';

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
const updates = Number(args.updates) || 50;
const files = Number(args.files) || 5000;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const benchRoot = args.root
  ? path.resolve(String(args.root))
  : path.join(process.cwd(), '.benchCache', 'index-state-write');

const makeIndexState = (updatedAt) => {
  const filesList = new Array(files);
  for (let i = 0; i < files; i += 1) {
    filesList[i] = `src/file-${i}.js`;
  }
  return {
    generatedAt: new Date().toISOString(),
    updatedAt,
    counts: { files, chunks: files * 2 },
    files: filesList,
    version: 1
  };
};

const writeBaseline = async (runRoot) => {
  const indexStatePath = path.join(runRoot, 'index_state.json');
  let bytes = 0;
  let writes = 0;
  const start = performance.now();
  for (let i = 0; i < updates; i += 1) {
    const indexState = makeIndexState(new Date().toISOString());
    await writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true });
    const stat = await fsPromises.stat(indexStatePath);
    bytes += stat.size;
    writes += 1;
  }
  return {
    label: 'baseline',
    totalMs: performance.now() - start,
    bytes,
    writes
  };
};

const writeCurrent = async (runRoot) => {
  const indexStatePath = path.join(runRoot, 'index_state.json');
  const metaPath = path.join(runRoot, 'index_state.meta.json');
  let bytes = 0;
  let writes = 0;
  const start = performance.now();
  for (let i = 0; i < updates; i += 1) {
    const indexState = makeIndexState(new Date().toISOString());
    const stableState = { ...indexState };
    delete stableState.generatedAt;
    delete stableState.updatedAt;
    const stableHash = sha1(stableStringifyForSignature(stableState));
    let canSkip = false;
    if (fs.existsSync(metaPath) && fs.existsSync(indexStatePath)) {
      try {
        const metaRaw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const meta = metaRaw?.fields && typeof metaRaw.fields === 'object' ? metaRaw.fields : metaRaw;
        if (meta?.stableHash === stableHash) {
          canSkip = true;
        }
      } catch {}
    }
    if (!canSkip) {
      await writeJsonObjectFile(indexStatePath, { fields: indexState, atomic: true });
      const stat = await fsPromises.stat(indexStatePath);
      bytes += stat.size;
      writes += 1;
    }
    await writeJsonObjectFile(metaPath, {
      fields: {
        stableHash,
        generatedAt: indexState.generatedAt,
        updatedAt: new Date().toISOString(),
        bytes: null
      },
      atomic: true
    });
  }
  return {
    label: 'current',
    totalMs: performance.now() - start,
    bytes,
    writes
  };
};

const formatLine = (result, baseline = null) => {
  const throughput = result.totalMs > 0 ? (updates / (result.totalMs / 1000)) : 0;
  const parts = [
    `updates=${updates}`,
    `files=${files}`,
    `total=${result.totalMs.toFixed(1)}ms`,
    `writes=${result.writes}`,
    `bytes=${result.bytes}`,
    `throughput=${throughput.toFixed(1)}/s`
  ];
  if (baseline) {
    const deltaMs = result.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (deltaMs / baseline.totalMs) * 100 : 0;
    const baseThroughput = updates / (baseline.totalMs / 1000);
    const deltaThroughput = throughput - baseThroughput;
    parts.push(`delta=${deltaMs.toFixed(1)}ms (${pct.toFixed(1)}%)`);
    parts.push(`throughputΔ=${deltaThroughput.toFixed(1)}/s`);
    parts.push(`bytesΔ=${result.bytes - baseline.bytes}`);
    parts.push(`writesΔ=${result.writes - baseline.writes}`);
  }
  return parts.join(' ');
};

await fsPromises.rm(benchRoot, { recursive: true, force: true });
await fsPromises.mkdir(benchRoot, { recursive: true });

let baseline = null;
let current = null;
if (mode !== 'current') {
  const runRoot = path.join(benchRoot, 'baseline');
  await fsPromises.mkdir(runRoot, { recursive: true });
  baseline = await writeBaseline(runRoot);
  console.log(`[bench] baseline ${formatLine(baseline)}`);
}
if (mode !== 'baseline') {
  const runRoot = path.join(benchRoot, 'current');
  await fsPromises.mkdir(runRoot, { recursive: true });
  current = await writeCurrent(runRoot);
  console.log(`[bench] current ${formatLine(current, baseline)}`);
  if (baseline) {
    const baseThroughput = updates / (baseline.totalMs / 1000);
    const curThroughput = updates / (current.totalMs / 1000);
    const deltaMs = current.totalMs - baseline.totalMs;
    const pct = baseline.totalMs > 0 ? (deltaMs / baseline.totalMs) * 100 : 0;
    console.log(
      `[bench] delta ms=${deltaMs.toFixed(1)} (${pct.toFixed(1)}%) throughput=${curThroughput.toFixed(
        1
      )}/s Δ=${(curThroughput - baseThroughput).toFixed(1)}/s bytes=${current.bytes - baseline.bytes}`
    );
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  updates,
  files,
  baseline,
  current
};
console.log(JSON.stringify(summary, null, 2));
