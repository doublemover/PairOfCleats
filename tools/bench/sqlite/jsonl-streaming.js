#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray, readJsonLinesEach } from '../../../src/shared/artifact-io.js';

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
const count = Number(args.count) || 10000;
const mode = ['baseline', 'current', 'compare'].includes(String(args.mode).toLowerCase())
  ? String(args.mode).toLowerCase()
  : 'compare';
const tempRoot = path.join(process.cwd(), '.benchCache', 'sqlite-jsonl-streaming');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const entries = Array.from({ length: count }, (_, i) => ({ id: i, value: `value-${i}` }));

const benchFile = async (label, compression) => {
  const filePath = path.join(tempRoot, `sample.jsonl${compression === 'gzip' ? '.gz' : compression === 'zstd' ? '.zst' : ''}`);
  await writeJsonLinesFile(filePath, entries, { compression, atomic: true });

  let arrayMs = null;
  let eachMs = null;
  let arrayCount = null;
  let eachCount = null;
  if (mode !== 'current') {
    const startArray = performance.now();
    const arr = await readJsonLinesArray(filePath);
    arrayMs = performance.now() - startArray;
    arrayCount = arr.length;
  }

  if (mode !== 'baseline') {
    let countEach = 0;
    const startEach = performance.now();
    await readJsonLinesEach(filePath, () => { countEach += 1; });
    eachMs = performance.now() - startEach;
    eachCount = countEach;
  }

  const parts = [];
  if (arrayMs !== null) parts.push(`array=${arrayMs.toFixed(1)}ms`);
  if (eachMs !== null) parts.push(`each=${eachMs.toFixed(1)}ms`);
  if (arrayMs !== null && eachMs !== null) {
    const deltaMs = eachMs - arrayMs;
    const deltaPct = arrayMs > 0 ? (deltaMs / arrayMs) * 100 : null;
    parts.push(`delta=${deltaMs.toFixed(1)}ms (${deltaPct?.toFixed(1)}%)`);
  }
  const counts = [arrayCount, eachCount].filter((value) => value !== null).join('/');
  console.log(`[bench] ${label} ${parts.join(' ')} count=${counts}`);
};

await benchFile('gzip', 'gzip');
try {
  await benchFile('zstd', 'zstd');
} catch (err) {
  console.warn(`[bench] zstd unavailable: ${err?.message || err}`);
}
