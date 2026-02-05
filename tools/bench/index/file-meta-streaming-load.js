import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadJsonArrayArtifact, loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io.js';
import { writeJsonLinesFile } from '../../../src/shared/json-stream.js';

const parseArgs = (argv) => {
  const args = { rows: 50000, indexDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--rows' && next) {
      args.rows = Math.max(1, Math.floor(Number(next)));
      i += 1;
    } else if (key === '--index-dir' && next) {
      args.indexDir = next;
      i += 1;
    }
  }
  return args;
};

const formatRate = (value) => (Number.isFinite(value) ? value.toFixed(1) : '0');

const loadFromIndex = async (indexDir) => {
  const baselineStart = performance.now();
  const baselineRows = await loadJsonArrayArtifact(indexDir, 'file_meta', { strict: false });
  const baselineMs = performance.now() - baselineStart;

  const currentStart = performance.now();
  let streamedCount = 0;
  for await (const _entry of loadJsonArrayArtifactRows(indexDir, 'file_meta', { strict: false })) {
    streamedCount += 1;
  }
  const currentMs = performance.now() - currentStart;

  return { baselineRows, baselineMs, streamedCount, currentMs };
};

const loadFromGenerated = async (rows) => {
  const benchRoot = path.join(process.cwd(), '.benchCache', 'file-meta-streaming-load');
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });
  const jsonlPath = path.join(benchRoot, 'file_meta.jsonl');
  const items = Array.from({ length: rows }, (_value, index) => ({
    id: index,
    file: 'src/dir-' + (index % 97).toString(36) + '/file-' + index + '.js',
    ext: 'js'
  }));
  await writeJsonLinesFile(jsonlPath, items);

  const baselineStart = performance.now();
  const baselineRows = await loadJsonArrayArtifact(benchRoot, 'file_meta', { strict: false });
  const baselineMs = performance.now() - baselineStart;

  const currentStart = performance.now();
  let streamedCount = 0;
  for await (const _entry of loadJsonArrayArtifactRows(benchRoot, 'file_meta', { strict: false })) {
    streamedCount += 1;
  }
  const currentMs = performance.now() - currentStart;

  return { baselineRows, baselineMs, streamedCount, currentMs };
};

const main = async () => {
  const { rows, indexDir } = parseArgs(process.argv.slice(2));
  const { baselineRows, baselineMs, streamedCount, currentMs } = indexDir
    ? await loadFromIndex(indexDir)
    : await loadFromGenerated(rows);

  const baselineRate = baselineRows.length / (baselineMs / 1000);
  const currentRate = streamedCount / (currentMs / 1000);
  const deltaMs = currentMs - baselineMs;
  const deltaPct = baselineMs ? (deltaMs / baselineMs) * 100 : 0;

  console.log(
    '[bench] baseline rows=' + baselineRows.length
      + ' ms=' + baselineMs.toFixed(1)
      + ' rowsPerSec=' + formatRate(baselineRate)
  );
  console.log(
    '[bench] current rows=' + streamedCount
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
