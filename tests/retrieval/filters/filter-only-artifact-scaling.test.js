import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-artifact-'));
const execute = promisify(execFile), rows = 10000;
try {
  const location = await createCompatibilityIndex(root, { compatibilityKey: 'artifact-pages', profileId: 'default' });
  await fs.writeFile(path.join(location, 'chunk_meta.json'), JSON.stringify(Array.from({ length: rows }, (_, id) => ({
    id, file: `src/${id}.ts`, kind: 'FunctionDeclaration', start: 0, end: 1, chunkUid: `uid:${id}`
  }))));
  const cacheDir = path.join(root, 'cache');
  let cursor = null, scans = 0, loads = 0, pages = 0;
  const ids = [];
  do {
    const result = await execute(process.execPath, ['tests/retrieval/filters/filter-only-native-page-child.js',
      JSON.stringify({ backend: 'cached', location, cacheDir, cursor })], { timeout: 5000, maxBuffer: 1048576 });
    const page = JSON.parse(result.stdout), cost = page.pagination.cost.byMode.code;
    assert.equal(page.pagination.total, rows);
    assert.equal(cost.startupWork.kind, cursor ? 'authenticated-metadata-seek-page' : 'artifact-materialization');
    assert.equal(cost.startupWork.tokenIndexLoaded, false);
    assert.equal(cost.startupWork.filterIndexBuilt, false);
    scans += cost.scannedMetadata; loads += cost.startupWork.metadataLoadedRows; pages++;
    ids.push(...page.ids); cursor = page.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: rows }, (_, id) => id));
  assert.equal(scans, rows);
  assert.equal(loads, rows + rows - 997);
  console.log(JSON.stringify({ backend: 'artifact-memory', rows, pages, predicateScans: scans, metadataLoadedRows: loads,
    qualification: 'real artifact loader; fresh process per page; wrapper startup acceptance is separate' }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
