#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeSqliteZeroStateManifest } from '../../../src/storage/sqlite/build/runner/config.js';
import { resolveBenchSqliteModeStatus } from '../../../tools/bench/language/sqlite-mode-status.js';
import { resolveBenchQueryBackends } from '../../../tools/bench/language/query-backends.js';
import { buildSearchCliArgs } from '../../../tools/shared/search-cli-harness.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = resolveTestCachePath(process.cwd(), `sqlite-zero-mode-status-${process.pid}-${Date.now()}`);
await fs.mkdir(root, { recursive: true });
const mode = 'prose';
const indexDir = path.join(root, 'index-prose');
const dbPath = path.join(root, 'index-prose.db');
const input = { mode, indexDir, dbPath };
try {
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false);
  const receiptPath = await writeSqliteZeroStateManifest({ modeIndexDir: indexDir, mode, outputPath: dbPath, chunkCount: 0, denseCount: 0 });
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false, 'receipt presence alone does not establish current empty mode');
  const state = { mode, generatedAt: '2026-01-01T00:00:00Z', sqlite: { status: 'ready',
    stats: { reason: 'empty-prose-artifacts', zeroStateManifestPath: receiptPath } } };
  const statePath = path.join(indexDir, 'index_state.json');
  await fs.writeFile(statePath, JSON.stringify(state));
  const confirmed = resolveBenchSqliteModeStatus(input);
  assert.equal(confirmed.zeroState, true);
  assert.equal(confirmed.dbExists, false);
  assert.equal(confirmed.zeroStateObservation, 'confirmed-empty');
  const decision = resolveBenchQueryBackends({ requestedBackends: ['memory', 'sqlite'],
    sqliteModes: { code: { dbExists: true }, prose: confirmed } });
  const sqliteArgs = buildSearchCliArgs({ query: 'fixture', backend: 'sqlite',
    mode: decision.coverage.selectedSearchModeByBackend.sqlite });
  assert.equal(sqliteArgs[sqliteArgs.indexOf('--mode') + 1], 'code', 'the actual search argument builder selects the usable code mode');
  const memoryArgs = buildSearchCliArgs({ query: 'fixture', backend: 'memory',
    mode: decision.coverage.selectedSearchModeByBackend.memory });
  assert.equal(memoryArgs.includes('--mode'), false, 'memory retains its existing default selection');
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, chunkCount: 1 }));
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false, 'nonzero or checksum-mismatched receipt is not empty');
  await fs.writeFile(receiptPath, JSON.stringify(receipt));
  assert.equal(resolveBenchSqliteModeStatus({ ...input, mode: 'code' }).zeroState, false);
  assert.equal(resolveBenchSqliteModeStatus({ ...input, dbPath: path.join(root, 'different.db') }).zeroState, false);
  await fs.writeFile(statePath, JSON.stringify({ ...state, generatedAt: '2099-01-01T00:00:00Z' }));
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false, 'a newer mode generation invalidates the old empty receipt');
  await fs.writeFile(statePath, JSON.stringify({ ...state, sqlite: { ...state.sqlite, status: 'running' } }));
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false);
  await fs.writeFile(statePath, JSON.stringify({ ...state, sqlite: { ...state.sqlite, pending: true } }));
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false);
  await fs.writeFile(receiptPath, '{ malformed');
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false);
  await fs.writeFile(receiptPath, JSON.stringify({ ...receipt, oversized: 'x'.repeat(64 * 1024) }));
  assert.equal(resolveBenchSqliteModeStatus(input).zeroState, false, 'oversized receipt cannot bypass bounded admission');
  console.log('Actual zero-state writer, bounded current-receipt admission and real search argument selection pass without native database work.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
