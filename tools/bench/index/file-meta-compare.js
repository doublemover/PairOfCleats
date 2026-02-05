import { performance } from 'node:perf_hooks';
import { buildFileMetaColumnar } from '../../../src/index/build/artifacts/file-meta.js';

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

const inflateColumnarRows = (payload) => {
  if (!payload || payload.format !== 'columnar') return null;
  const columns = Array.isArray(payload.columns) ? payload.columns : null;
  const length = Number.isFinite(payload.length) ? payload.length : 0;
  const arrays = payload.arrays && typeof payload.arrays === 'object' ? payload.arrays : null;
  if (!columns || !arrays || !length) return null;
  const tables = payload.tables && typeof payload.tables === 'object' ? payload.tables : null;
  const rows = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const row = {};
    for (const column of columns) {
      const values = arrays[column];
      const value = values ? values[i] : null;
      const table = tables ? tables[column] : null;
      row[column] = table && Number.isInteger(value) ? (table[value] ?? null) : value;
    }
    rows[i] = row;
  }
  return rows;
};

const args = parseArgs();
const files = Number(args.files) || 50000;
const iterations = Number(args.iterations) || 5;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const buildFileMeta = () => {
  const entries = new Array(files);
  for (let i = 0; i < files; i += 1) {
    entries[i] = {
      id: i,
      file: `src/dir-${(i % 50).toString(36)}/file-${i}.js`,
      ext: '.js',
      encoding: 'utf8',
      encodingFallback: false,
      encodingConfidence: 1
    };
  }
  return entries;
};

const runTimed = (fn) => {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn();
  }
  return performance.now() - start;
};

const fileMeta = buildFileMeta();
const jsonString = JSON.stringify(fileMeta);
const jsonBytes = Buffer.byteLength(jsonString);
const columnarPayload = buildFileMetaColumnar(fileMeta);
const columnarString = JSON.stringify(columnarPayload);
const columnarBytes = Buffer.byteLength(columnarString);

let baseline = null;
let current = null;
if (mode !== 'current') {
  const parseMs = runTimed(() => {
    JSON.parse(jsonString);
  });
  baseline = {
    label: 'json',
    parseMs,
    bytes: jsonBytes
  };
  const throughput = (files * iterations) / (parseMs / 1000);
  console.log(
    `[bench] baseline files=${files} bytes=${jsonBytes} parse=${parseMs.toFixed(1)}ms throughput=${throughput.toFixed(1)}/s`
  );
}
if (mode !== 'baseline') {
  const parseMs = runTimed(() => {
    const parsed = JSON.parse(columnarString);
    inflateColumnarRows(parsed);
  });
  current = {
    label: 'columnar',
    parseMs,
    bytes: columnarBytes
  };
  const throughput = (files * iterations) / (parseMs / 1000);
  const parts = [
    `files=${files}`,
    `bytes=${columnarBytes}`,
    `parse=${parseMs.toFixed(1)}ms`,
    `throughput=${throughput.toFixed(1)}/s`
  ];
  if (baseline) {
    const deltaMs = parseMs - baseline.parseMs;
    const pct = baseline.parseMs > 0 ? (deltaMs / baseline.parseMs) * 100 : 0;
    const baseThroughput = (files * iterations) / (baseline.parseMs / 1000);
    const deltaThroughput = throughput - baseThroughput;
    parts.push(`delta=${deltaMs.toFixed(1)}ms (${pct.toFixed(1)}%)`);
    parts.push(`throughputΔ=${deltaThroughput.toFixed(1)}/s`);
    parts.push(`bytesΔ=${columnarBytes - baseline.bytes}`);
  }
  console.log(`[bench] current ${parts.join(' ')}`);
  if (baseline) {
    const deltaMs = parseMs - baseline.parseMs;
    const pct = baseline.parseMs > 0 ? (deltaMs / baseline.parseMs) * 100 : 0;
    const baseThroughput = (files * iterations) / (baseline.parseMs / 1000);
    const deltaThroughput = throughput - baseThroughput;
    console.log(
      `[bench] delta ms=${deltaMs.toFixed(1)} (${pct.toFixed(1)}%) throughput=${throughput.toFixed(
        1
      )}/s Δ=${deltaThroughput.toFixed(1)}/s bytes=${columnarBytes - baseline.bytes}`
    );
  }
}

const summary = {
  generatedAt: new Date().toISOString(),
  files,
  iterations,
  baseline,
  current
};
console.log(JSON.stringify(summary, null, 2));
