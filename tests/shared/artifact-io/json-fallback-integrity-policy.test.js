#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  readJsonFile,
  readJsonLinesArray,
  readJsonLinesEach,
  readJsonLinesIterator
} from '../../../src/shared/artifact-io.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-artifact-fallback-integrity-'));

try {
  const jsonPath = path.join(tempRoot, 'config.json');
  await fs.writeFile(jsonPath, '{bad json', 'utf8');
  await fs.writeFile(`${jsonPath}.gz`, gzipSync(JSON.stringify({ source: 'compressed-sibling' })));

  assert.throws(
    () => readJsonFile(jsonPath),
    'strict mode should surface primary json parse failures'
  );
  assert.deepEqual(
    readJsonFile(jsonPath, { recoveryFallback: true }),
    { source: 'compressed-sibling' },
    'recovery mode should allow compressed sibling fallback'
  );

  const jsonlPath = path.join(tempRoot, 'rows.jsonl');
  await fs.writeFile(jsonlPath, `${JSON.stringify({ id: 1 })}\n{bad\n`, 'utf8');
  await fs.writeFile(`${jsonlPath}.gz`, gzipSync(`${JSON.stringify({ id: 99 })}\n`));

  const eachRows = [];
  await assert.rejects(
    () => readJsonLinesEach(jsonlPath, (row) => eachRows.push(row)),
    'strict mode should surface primary jsonl parse failures'
  );
  assert.equal(
    eachRows.some((row) => row?.id === 99),
    false,
    'strict mode should not append fallback rows after primary parse failure'
  );

  const iteratorRows = [];
  await assert.rejects(
    async () => {
      for await (const row of readJsonLinesIterator(jsonlPath)) {
        iteratorRows.push(row);
      }
    },
    'iterator strict mode should surface primary jsonl parse failures'
  );
  assert.equal(
    iteratorRows.some((row) => row?.id === 99),
    false,
    'iterator strict mode should not append fallback rows after primary parse failure'
  );

  await assert.rejects(
    () => readJsonLinesArray(jsonlPath),
    'array strict mode should surface primary jsonl parse failures'
  );
  const recoveredArrayRows = await readJsonLinesArray(jsonlPath, { recoveryFallback: true });
  assert.deepEqual(
    recoveredArrayRows,
    [{ id: 99 }],
    'array recovery mode should allow compressed fallback after primary failure'
  );

  const missingJsonlPath = path.join(tempRoot, 'missing.jsonl');
  await fs.writeFile(`${missingJsonlPath}.gz`, gzipSync(`${JSON.stringify({ id: 7 })}\n`));
  const missingEachRows = [];
  await readJsonLinesEach(
    missingJsonlPath,
    (row) => missingEachRows.push(row),
    { recoveryFallback: true }
  );
  assert.deepEqual(
    missingEachRows,
    [{ id: 7 }],
    'recovery mode should preserve missing-primary fallback behavior'
  );
  const missingIteratorRows = [];
  for await (const row of readJsonLinesIterator(missingJsonlPath, { recoveryFallback: true })) {
    missingIteratorRows.push(row);
  }
  assert.deepEqual(
    missingIteratorRows,
    [{ id: 7 }],
    'iterator should honor recovery fallback mode for missing primaries'
  );

  console.log('json fallback integrity policy test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
