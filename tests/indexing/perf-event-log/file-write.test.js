#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { createPerfEventLogger } from '../../../src/index/build/perf-event-log.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-perf-log-'));
try {
  const logger = await createPerfEventLogger({
    buildRoot: tempRoot,
    mode: 'code',
    stream: 'heavy-file',
    flushRows: 1
  });
  assert.equal(logger.enabled, true, 'expected perf event logger to initialize');
  logger.emit('perf.heavy_file_policy', {
    file: 'src/example.swift',
    sourceChunks: 72,
    workingChunks: 24,
    heavyDownshift: true
  });
  await logger.close();
  const raw = await fs.readFile(logger.path, 'utf8');
  const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(rows.length, 1, 'expected one JSONL row');
  assert.equal(rows[0].event, 'perf.heavy_file_policy');
  assert.equal(rows[0].file, 'src/example.swift');
  assert.equal(rows[0].heavyDownshift, true);
  assert.equal(rows[0].sourceChunks, 72);
  assert.equal(rows[0].workingChunks, 24);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('perf event log file write test passed');
