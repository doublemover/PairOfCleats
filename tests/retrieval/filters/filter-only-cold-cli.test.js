import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-filter-cli-cold-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache') });
try {
  const indexDir = await createCompatibilityIndex(root, { published: true, compatibilityKey: 'cold-enumeration', profileId: 'default' });
  const rows = 1000;
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), JSON.stringify(Array.from({ length: rows }, (_, id) => ({
    id, file: 'src/' + id + '.ts', kind: 'FunctionDeclaration', name: 'fn' + id, start: 0, end: 1, chunkUid: 'uid:' + id }))));
  const execute = promisify(execFile); let cursor = null, scans = 0, loads = 0, pages = 0; const ids = [];
  do {
    const result = await execute(process.execPath, ['bin/pairofcleats.js', 'search', '--repo', root, '--backend', 'memory', '--mode', 'code',
      '--json', '--compact', '--no-comments', '--type', 'FunctionDeclaration', '--top', '257', ...(cursor ? ['--cursor', cursor] : [])],
    { timeout: 5000, maxBuffer: 1048576 });
    const page = JSON.parse(result.stdout), cost = page.pagination.cost.byMode.code;
    assert.equal(page.pagination.total, rows); assert.equal(cost.startupWork.tokenIndexLoaded, false);
    assert.equal(cost.startupWork.filterIndexBuilt, false);
    assert.equal(cost.startupWork.kind, cursor ? 'authenticated-metadata-seek-page' : 'artifact-materialization');
    if (cursor) assert.equal(cost.matchingRepresentation, 'persisted-seek');
    scans += cost.scannedMetadata; loads += cost.startupWork.metadataLoadedRows; pages += 1;
    ids.push(...page.code.map(row => row.id)); cursor = page.pagination.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, Array.from({ length: rows }, (_, id) => id)); assert.equal(scans, rows);
  assert.equal(loads, rows + rows - 257, 'cold continuation hydrates only the requested page');
  console.log(JSON.stringify({ qualification: 'real wrapper; fresh process per page', backend: 'artifact-memory', rows, pages,
    predicateScans: scans, metadataLoadedRows: loads, limitation: 'oversized or invalid continuation representations fall back to the authoritative artifact loader' }));
} finally { await fs.rm(root, { recursive: true, force: true }); }
