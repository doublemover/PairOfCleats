#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

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
const rows = Number(args.rows) || 200000;
const payloadBytes = Number(args.payloadBytes) || 128;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';

const benchRoot = path.join(process.cwd(), '.benchCache', 'jsonl-compression-pipeline');
await fs.mkdir(benchRoot, { recursive: true });

const buildRows = () => {
  const payload = 'x'.repeat(Math.max(1, payloadBytes));
  return Array.from({ length: rows }, (_, index) => ({
    id: index,
    payload
  }));
};

const resolveExtension = (compression) => {
  if (compression === 'gzip') return 'jsonl.gz';
  if (compression === 'zstd') return 'jsonl.zst';
  return 'jsonl';
};

const runOnce = async ({ label, compression }) => {
  const extension = resolveExtension(compression);
  const filePath = path.join(benchRoot, `rows-${label}.${extension}`);
  await fs.rm(filePath, { force: true });
  const items = buildRows();
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  await writeJsonLinesFile(filePath, items, { compression, atomic: true });
  const durationMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  const size = (await fs.stat(filePath)).size;
  return { label, durationMs, cpuMs, size };
};

const printResult = (result, baseline = null) => {
  const parts = [
    `ms=${result.durationMs.toFixed(1)}`,
    `cpuMs=${result.cpuMs.toFixed(1)}`,
    `bytes=${result.size}`
  ];
  if (baseline) {
    const delta = result.durationMs - baseline.durationMs;
    const pct = baseline.durationMs > 0 ? (delta / baseline.durationMs) * 100 : null;
    const sizeDelta = baseline.size > 0 ? (result.size / baseline.size) : null;
    parts.push(`delta=${delta.toFixed(1)}ms (${pct?.toFixed(1)}%)`);
    parts.push(`sizeRatio=${sizeDelta?.toFixed(2)}x`);
  }
  console.log(`[bench] ${result.label} ${parts.join(' ')}`);
};

let baseline = null;
if (mode !== 'current') {
  baseline = await runOnce({ label: 'baseline', compression: null });
  printResult(baseline);
}

if (mode !== 'baseline') {
  const gzip = await runOnce({ label: 'gzip', compression: 'gzip' });
  printResult(gzip, baseline);
  const zstd = await runOnce({ label: 'zstd', compression: 'zstd' });
  printResult(zstd, baseline);
}
