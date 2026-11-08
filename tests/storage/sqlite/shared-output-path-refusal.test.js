#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveOutputPaths } from '../../../src/storage/sqlite/build/output-paths.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sqlite-shared-output-'));
try {
  const shared = path.join(root, 'shared.db');
  await fs.writeFile(shared, 'previous code and prose authority');
  const sqlitePaths = { codePath: shared, prosePath: shared,
    extractedProsePath: path.join(root, 'extracted.db'), recordsPath: path.join(root, 'records.db') };
  assert.throws(() => resolveOutputPaths({ modeArg: 'all', sqlitePaths }), { code: 'ERR_SQLITE_DUPLICATE_OUTPUT' });
  if (process.platform === 'win32') assert.throws(() => resolveOutputPaths({ modeArg: 'all',
    sqlitePaths: { ...sqlitePaths, prosePath: shared.toUpperCase() } }), { code: 'ERR_SQLITE_DUPLICATE_OUTPUT' });
  assert.equal(await fs.readFile(shared, 'utf8'), 'previous code and prose authority');
  assert.equal(resolveOutputPaths({ modeArg: 'code', sqlitePaths }).outPath, shared);
  const distinct = resolveOutputPaths({ modeArg: 'all', outArg: path.join(root, 'separate'), sqlitePaths });
  assert.notEqual(distinct.codeOutPath, distinct.proseOutPath);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('multi-mode SQLite planning refuses colliding physical output authority');
