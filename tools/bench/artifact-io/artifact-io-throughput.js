import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesShardedAsync } from '../../../src/shared/json-stream.js';
import { readJsonLinesArray } from '../../../src/shared/artifact-io/json.js';

const parseArgs = (argv) => {
  const args = { rows: 20000, shardBytes: 128 * 1024, concurrency: 4 };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--rows' && next) {
      args.rows = Math.max(1, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--shard-bytes' && next) {
      args.shardBytes = Math.max(1024, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--concurrency' && next) {
      args.concurrency = Math.max(1, Math.floor(Number(next)));
      i += 1;
    }
  }
  return args;
};

const formatRate = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0');

const joinRel = (root, relPath) => path.join(root, ...String(relPath).split('/'));

const main = async () => {
  const { rows, shardBytes, concurrency } = parseArgs(process.argv.slice(2));
  const benchRoot = path.join(process.cwd(), '.benchCache', 'artifact-io-throughput');
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });

  const items = [];
  for (let i = 0; i < rows; i += 1) {
    items.push({ id: i, name: `row-${i}`, value: `payload-${i}` });
  }

  const sharded = await writeJsonLinesShardedAsync({
    dir: benchRoot,
    partsDirName: 'parts',
    partPrefix: 'part-',
    items,
    maxBytes: shardBytes,
    atomic: true
  });
  const paths = sharded.parts.map((rel) => joinRel(benchRoot, rel));

  const baselineStart = performance.now();
  const baselineRows = await readJsonLinesArray(paths, { concurrency: 1 });
  const baselineMs = performance.now() - baselineStart;

  const currentStart = performance.now();
  const currentRows = await readJsonLinesArray(paths, { concurrency });
  const currentMs = performance.now() - currentStart;

  const baselineRate = baselineRows.length / (baselineMs / 1000);
  const currentRate = currentRows.length / (currentMs / 1000);
  const deltaMs = currentMs - baselineMs;
  const deltaPct = baselineMs ? (deltaMs / baselineMs) * 100 : 0;

  console.log(
    `[bench] baseline rows=${baselineRows.length} ms=${baselineMs.toFixed(1)} ` +
    `rowsPerSec=${formatRate(baselineRate)}`
  );
  console.log(
    `[bench] current rows=${currentRows.length} ms=${currentMs.toFixed(1)} ` +
    `rowsPerSec=${formatRate(currentRate)}`
  );
  console.log(
    `[bench] delta ms=${deltaMs.toFixed(1)} (${deltaPct.toFixed(1)}%) ` +
    `rowsPerSec=${formatRate(currentRate - baselineRate)} duration=${currentMs.toFixed(1)}ms`
  );
};

await main();
