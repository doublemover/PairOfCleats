import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readJsonLinesArray, readJsonLinesIterator } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const parseArgs = (argv) => {
  const args = { rows: 50000 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--rows' && next) {
      args.rows = Math.max(1, Math.floor(Number(next)));
      i += 1;
    }
  }
  return args;
};

const formatRate = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0');

const main = async () => {
  const { rows } = parseArgs(process.argv.slice(2));
  const benchRoot = path.join(process.cwd(), '.benchCache', 'artifact-io-streaming');
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });
  const jsonlPath = path.join(benchRoot, 'rows.jsonl');

  const items = Array.from({ length: rows }, (_value, index) => ({
    id: index,
    value: `value-${index}`,
    mod: index % 13
  }));
  await writeJsonLinesFile(jsonlPath, items);

  const baselineStart = performance.now();
  const baselineRows = await readJsonLinesArray(jsonlPath);
  const baselineMs = performance.now() - baselineStart;

  const currentStart = performance.now();
  let streamedCount = 0;
  for await (const _entry of readJsonLinesIterator(jsonlPath)) {
    streamedCount += 1;
  }
  const currentMs = performance.now() - currentStart;

  const baselineRate = baselineRows.length / (baselineMs / 1000);
  const currentRate = streamedCount / (currentMs / 1000);
  const deltaMs = currentMs - baselineMs;
  const deltaPct = baselineMs ? (deltaMs / baselineMs) * 100 : 0;

  console.log(
    '[bench] baseline rows=' + baselineRows.length + '/' + rows
      + ' ms=' + baselineMs.toFixed(1)
      + ' rowsPerSec=' + formatRate(baselineRate)
  );
  console.log(
    '[bench] current rows=' + streamedCount + '/' + rows
      + ' ms=' + currentMs.toFixed(1)
      + ' rowsPerSec=' + formatRate(currentRate)
  );
  console.log(
    '[bench] delta ms=' + deltaMs.toFixed(1)
      + ' (' + deltaPct.toFixed(1) + '%)'
      + ' rowsPerSec=' + formatRate(currentRate - baselineRate)
      + ' duration=' + currentMs.toFixed(1) + 'ms'
  );
};

await main();
