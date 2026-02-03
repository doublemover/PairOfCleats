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
const tempRoot = path.join(process.cwd(), '.benchCache', 'sqlite-jsonl-streaming');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const entries = Array.from({ length: count }, (_, i) => ({ id: i, value: `value-${i}` }));

const benchFile = async (label, compression) => {
  const filePath = path.join(tempRoot, `sample.jsonl${compression === 'gzip' ? '.gz' : compression === 'zstd' ? '.zst' : ''}`);
  await writeJsonLinesFile(filePath, entries, { compression, atomic: true });

  const startArray = performance.now();
  const arr = await readJsonLinesArray(filePath);
  const arrayMs = performance.now() - startArray;

  let countEach = 0;
  const startEach = performance.now();
  await readJsonLinesEach(filePath, () => { countEach += 1; });
  const eachMs = performance.now() - startEach;

  console.log(`[bench] ${label} array=${arrayMs.toFixed(1)}ms each=${eachMs.toFixed(1)}ms count=${arr.length}/${countEach}`);
};

await benchFile('gzip', 'gzip');
try {
  await benchFile('zstd', 'zstd');
} catch (err) {
  console.warn(`[bench] zstd unavailable: ${err?.message || err}`);
}
