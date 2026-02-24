#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  readJsonFile,
  readJsonLinesArray,
  readJsonLinesArraySync,
  readJsonLinesEach,
  readJsonLinesIterator
} from '../../../src/shared/artifact-io.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-fallback-order-'));

try {
  const jsonPath = path.join(tempRoot, 'config.json');
  await fs.writeFile(`${jsonPath}.gz`, 'not-a-gzip-stream', 'utf8');
  await fs.writeFile(`${jsonPath}.bak`, JSON.stringify({ source: 'backup' }), 'utf8');

  const jsonPayload = readJsonFile(jsonPath);
  assert.deepEqual(
    jsonPayload,
    { source: 'backup' },
    'expected strict-mode json fallback to continue after bad compressed candidate'
  );

  const jsonlPath = path.join(tempRoot, 'rows.jsonl');
  await fs.writeFile(`${jsonlPath}.bak`, '{bad\n', 'utf8');
  await fs.writeFile(`${jsonlPath}.gz`, gzipSync(`${JSON.stringify({ id: 7 })}\n`));

  const eachRows = [];
  await readJsonLinesEach(jsonlPath, (row) => eachRows.push(row));
  assert.deepEqual(
    eachRows,
    [{ id: 7 }],
    'expected readJsonLinesEach to continue to compressed fallback after bad .bak'
  );

  const arrayRows = await readJsonLinesArray(jsonlPath);
  assert.deepEqual(
    arrayRows,
    [{ id: 7 }],
    'expected readJsonLinesArray to continue to compressed fallback after bad .bak'
  );

  const arrayRowsSync = readJsonLinesArraySync(jsonlPath);
  assert.deepEqual(
    arrayRowsSync,
    [{ id: 7 }],
    'expected readJsonLinesArraySync to continue to compressed fallback after bad .bak'
  );

  const iteratorRows = [];
  for await (const row of readJsonLinesIterator(jsonlPath)) {
    iteratorRows.push(row);
  }
  assert.deepEqual(
    iteratorRows,
    [{ id: 7 }],
    'expected readJsonLinesIterator to continue to compressed fallback after bad .bak'
  );

  console.log('json fallback missing-primary candidate failure test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
