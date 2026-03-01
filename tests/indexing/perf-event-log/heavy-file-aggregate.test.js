#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createHeavyFilePerfAggregator, createPerfEventLogger } from '../../../src/index/build/perf-event-log.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-perf-log-agg-'));
try {
  const baseLogger = await createPerfEventLogger({
    buildRoot: tempRoot,
    mode: 'code',
    stream: 'heavy-file',
    flushRows: 1
  });
  const logger = createHeavyFilePerfAggregator({
    logger: baseLogger,
    sampleLimit: 2
  });
  logger.emit('perf.heavy_file_policy', {
    file: 'src/a.cpp',
    languageId: 'cpp',
    sourceChunks: 120,
    workingChunks: 30,
    outputChunks: 30,
    fileBytes: 1000,
    fileLines: 100,
    processingDurationMs: 10,
    heavyDownshift: true,
    skipTokenization: false,
    coalesced: true
  });
  logger.emit('perf.heavy_file_policy', {
    file: 'src/b.cpp',
    languageId: 'cpp',
    sourceChunks: 80,
    workingChunks: 20,
    outputChunks: 20,
    fileBytes: 2000,
    fileLines: 200,
    processingDurationMs: 50,
    heavyDownshift: true,
    skipTokenization: true,
    coalesced: true
  });
  logger.emit('perf.other', { foo: 'bar' });

  await logger.close();

  const raw = await fs.readFile(logger.path, 'utf8');
  const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(rows.length, 2, 'expected passthrough row and aggregated summary row');
  assert.equal(rows[0].event, 'perf.other');
  assert.equal(rows[1].event, 'perf.heavy_file_policy.summary');
  assert.equal(rows[1].files, 2);
  assert.equal(rows[1].heavyDownshiftFiles, 2);
  assert.equal(rows[1].skipTokenizationFiles, 1);
  assert.equal(rows[1].coalescedFiles, 2);
  assert.equal(rows[1].maxProcessingDurationMs, 50);
  assert.equal(rows[1].maxProcessingDurationFile, 'src/b.cpp');
  assert.equal(Array.isArray(rows[1].topSlowFiles), true);
  assert.equal(rows[1].topSlowFiles.length, 2);
  assert.equal(rows[1].topSlowFiles[0].file, 'src/b.cpp');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('perf event log heavy file aggregate test passed');
