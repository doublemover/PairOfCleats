#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { listRuntimeFamilies } from '../../../src/index/semantic/runtime/families.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
try {
  const imported = await importRuntimeEvidence(fixture.options());
  const destination = fixture.options().destination;
  const root = path.join(destination, 'generations', imported.pointer.generationId);
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    familyGenerations: [imported.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 1, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  const query = () => queryRuntimeEvidence({ destination, request });
  const pointer = await fs.readFile(path.join(destination, 'current.json'));
  for (const name of ['query.sqlite', 'evidence.offsets', 'evidence.jsonl', 'capture.json']) {
    const filename = path.join(root, name), original = await fs.readFile(filename);
    const changed = Buffer.from(original); changed[0] ^= 1;
    await fs.writeFile(filename, changed);
    try { await assert.rejects(query(), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' }); }
    finally { await fs.writeFile(filename, original); }
  }
  const manifestPath = path.join(root, 'manifest.json'), originalManifest = await fs.readFile(manifestPath);
  const manifest = JSON.parse(originalManifest);
  const missing = { ...manifest }; delete missing.queryIndex;
  await fs.writeFile(manifestPath, JSON.stringify(missing));
  await assert.rejects(query(), { code: 'ERR_RUNTIME_QUERY_INDEX_UNAVAILABLE' });
  await fs.writeFile(manifestPath, JSON.stringify({ ...manifest, queryIndex: { ...manifest.queryIndex, formatVersion: '0' } }));
  await assert.rejects(query(), { code: 'ERR_RUNTIME_FAMILY_CONTRACT' });
  await fs.writeFile(manifestPath, originalManifest);
  const missingFamily = { ...missing, generationId: null };
  missingFamily.generationId = semanticHash('pairofcleats.runtime.family.v1', missingFamily);
  const missingRoot = path.join(destination, 'generations', missingFamily.generationId);
  await fs.cp(root, missingRoot, { recursive: true });
  await fs.writeFile(path.join(missingRoot, 'manifest.json'), JSON.stringify(missingFamily));
  const inventory = await listRuntimeFamilies({ destination });
  assert.deepEqual(inventory.families.map(row => row.queryIndexState).sort(), ['available', 'unavailable-reingest']);
  await assert.rejects(queryRuntimeEvidence({ destination, request: { ...request, familyGenerations: [missingFamily.generationId] } }),
    { code: 'ERR_RUNTIME_QUERY_INDEX_UNAVAILABLE' });
  const second = await importRuntimeEvidence(fixture.options());
  assert.equal(second.pointer.generationId, imported.pointer.generationId, 'same-format reingestion reproduces the immutable lookup image');
  assert.equal((await query()).observations.length, 1);
  const abort = new AbortController(), originalOpen = fs.open;
  let offsetOpens = 0;
  fs.open = async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('evidence.offsets') && args[1] === 'r' && ++offsetOpens === 2) {
      const originalRead = handle.read;
      handle.read = async (...readArgs) => {
        const result = await originalRead.apply(handle, readArgs);
        abort.abort(); return result;
      };
    }
    return handle;
  };
  try { await assert.rejects(queryRuntimeEvidence({ destination, request, signal: abort.signal }), { code: 'ABORT_ERR' }); }
  finally { fs.open = originalOpen; }
  assert.equal(offsetOpens, 2, 'cancellation happens after SQLite opens and during selected row hydration');
  // Windows denies this rename for a leaked open SQLite handle.
  const index = path.join(root, 'query.sqlite');
  await fs.rename(index, index + '.closed'); await fs.rename(index + '.closed', index);
  assert.deepEqual(await fs.readFile(path.join(destination, 'current.json')), pointer);
  console.log('runtime index, offsets, selected rows and capture hashes reject tamper; missing index requires reingestion and query handles close');
} finally { await fixture.cleanup(); }
