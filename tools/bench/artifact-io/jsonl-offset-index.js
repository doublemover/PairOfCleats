import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json.js';
import { readJsonlRowAt } from '../../../src/shared/artifact-io/offsets.js';

const parseArgs = (argv) => {
  const args = { rows: 20000, stride: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--rows' && next) {
      args.rows = Math.max(1, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--stride' && next) {
      args.stride = Math.max(1, Math.floor(Number(next)));
      i += 1;
    }
  }
  return args;
};

const formatRate = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0');

const main = async () => {
  const { rows, stride } = parseArgs(process.argv.slice(2));
  const benchRoot = path.join(process.cwd(), '.benchCache', 'jsonl-offset-index');
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });
  const jsonlPath = path.join(benchRoot, 'rows.jsonl');
  const offsetsPath = `${jsonlPath}.offsets.bin`;

  const items = [];
  const rowIndexes = [];
  for (let i = 0; i < rows; i += 1) {
    items.push({ id: i, file: `file-${i % 97}`, value: `value-${i}` });
    if (i % stride === 0) rowIndexes.push(i);
  }
  await writeJsonLinesFile(jsonlPath, items, { offsets: { path: offsetsPath, atomic: true } });

  const baselineStart = performance.now();
  const baselineRows = await readJsonLinesArray(jsonlPath);
  const baselinePicked = rowIndexes.map((index) => baselineRows[index]).filter(Boolean);
  const baselineMs = performance.now() - baselineStart;

  const currentStart = performance.now();
  const currentPicked = [];
  for (const index of rowIndexes) {
    const row = await readJsonlRowAt(jsonlPath, offsetsPath, index);
    if (row) currentPicked.push(row);
  }
  const currentMs = performance.now() - currentStart;

  const baselineRate = baselinePicked.length / (baselineMs / 1000);
  const currentRate = currentPicked.length / (currentMs / 1000);
  const deltaMs = currentMs - baselineMs;
  const deltaPct = baselineMs ? (deltaMs / baselineMs) * 100 : 0;

  console.log(
    `[bench] baseline rows=${baselinePicked.length}/${rows} ` +
    `ms=${baselineMs.toFixed(1)} rowsPerSec=${formatRate(baselineRate)}`
  );
  console.log(
    `[bench] current rows=${currentPicked.length}/${rows} ` +
    `ms=${currentMs.toFixed(1)} rowsPerSec=${formatRate(currentRate)}`
  );
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `rowsPerSec=${formatRate(currentRate - baselineRate)} duration=${currentMs.toFixed(1)}ms`
  );
};

await main();
