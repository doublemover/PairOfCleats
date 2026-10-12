import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence, verifyRuntimeFamily } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { openRuntimeQueryFamily } from '../../../src/index/semantic/runtime/query-store.js';
import { openVerifiedRuntimeMember } from '../../../src/index/semantic/runtime/verified-reads.js';

const fixture = await createRuntimeImportFixture();
try {
  const options = fixture.options(), imported = await importRuntimeEvidence(options);
  const manifest = (await verifyRuntimeFamily({ destination: options.destination, pointer: imported.pointer })).manifest;
  const root = path.join(options.destination, 'generations', imported.pointer.generationId);
  const capturePath = path.join(root, 'capture.json'), original = await fs.readFile(capturePath);
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    familyGenerations: [imported.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 1, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  for (const mode of ['replacement', 'growth', 'symlink', 'cancellation']) {
    const controller = new AbortController(), originalOpen = fs.open;
    const outside = path.join(fixture.root, 'outside.json'), backup = path.join(root, 'capture.backup');
    const handles = new Set();
    let injected = false;
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), originalClose = handle.close.bind(handle);
      handles.add(handle);
      handle.close = async () => { try { return await originalClose(); } finally { handles.delete(handle); } };
      if (String(args[0]) === capturePath) {
        const originalRead = handle.read.bind(handle);
        handle.read = async (...readArgs) => {
          const result = await originalRead(...readArgs);
          if (!injected) {
            injected = true;
            if (mode === 'replacement') {
              await fs.writeFile(outside, original); await fs.rename(outside, capturePath);
            } else if (mode === 'growth') await fs.appendFile(capturePath, ' changed');
            else if (mode === 'symlink') {
              await fs.writeFile(outside, original); await fs.rename(capturePath, backup); await fs.symlink(outside, capturePath);
            } else controller.abort();
          }
          return result;
        };
      }
      return handle;
    };
    try {
      await assert.rejects(queryRuntimeEvidence({ destination: options.destination, request, signal: controller.signal }),
        mode === 'cancellation' ? { code: 'ABORT_ERR' } : { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
      assert.equal(handles.size, 0, 'all opened members close on integrity or cancellation failure');
    } finally {
      fs.open = originalOpen;
      if (mode === 'symlink') { await fs.unlink(capturePath); await fs.rename(backup, capturePath); }
      else await fs.writeFile(capturePath, original);
      await fs.rm(outside, { force: true });
    }
  }
  const first = await queryRuntimeEvidence({ destination: options.destination, request });
  assert.equal(first.cost.familyOpens, 1);
  assert.ok(first.cost.verificationBytes > original.length, 'receipt includes SQLite/offset/metadata/returned-row verification');
  assert.ok(first.nextCursor);
  const second = await queryRuntimeEvidence({ destination: options.destination, request: { ...request, cursor: first.nextCursor } });
  assert.equal(second.cost.familyOpens, 1);
  assert.ok(second.cost.verificationBytes > 0);
  assert.notEqual(first.observations[0].evidenceId, second.observations[0].evidenceId);
  const index = path.join(root, 'query.sqlite'), saved = await fs.readFile(index);
  await fs.writeFile(index, Buffer.concat([saved, Buffer.alloc(1)]));
  await assert.rejects(queryRuntimeEvidence({ destination: options.destination, request }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
  await fs.writeFile(index, saved);
  const evidencePath = path.join(root, manifest.evidence.path);
  const retainedPath = path.join(root, 'retained-evidence');
  const open = fs.open, handles = new Set();
  let switched = false;
  fs.open = async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    handles.add(handle); handle.close = async () => { try { return await close(); } finally { handles.delete(handle); } };
    if (String(args[0]) === evidencePath) {
      const before = await handle.stat(), read = handle.read.bind(handle);
      // Pin the stat receipt to isolate the containment recheck from unrelated
      // platform timestamp changes while preserving a real same-inode swap.
      handle.stat = async () => before;
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!switched) { switched = true; await fs.rename(evidencePath, retainedPath); await fs.symlink(retainedPath, evidencePath); }
        return result;
      };
    }
    return handle;
  };
  try {
    await assert.rejects(openVerifiedRuntimeMember({ root, relativePath: manifest.evidence.path,
      expectedHash: manifest.evidence.hash, expectedBytes: manifest.evidence.byteLength,
      maxBytes: 1024 * 1024 }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
    assert.equal(switched, true);
    assert.equal(handles.size, 0, 'streaming containment failure closes the original owned descriptor');
  } finally { fs.open = open; if (switched) { await fs.unlink(evidencePath); await fs.rename(retainedPath, evidencePath); } }

  fs.open = async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    handles.add(handle); handle.close = async () => { try { return await close(); } finally { handles.delete(handle); } };
    return handle;
  };
  let family, prototype, prototypeClose, failedDatabase;
  try {
    family = await openRuntimeQueryFamily({ destination: options.destination, generationId: imported.pointer.generationId });
    const databaseClose = family.db.close.bind(family.db);
    const closeError = Object.assign(new Error('injected native database close failure'), { code: 'ERR_FIXTURE_DATABASE_CLOSE' });
    family.db.close = () => { throw closeError; };
    await assert.rejects(family.close(), error => error === closeError);
    assert.equal(handles.size, 0, 'native close failure cannot bypass evidence FD close');
    databaseClose();
    prototype = Object.getPrototypeOf(family.db); prototypeClose = prototype.close;
    prototype.close = function () { failedDatabase = this; throw closeError; };
    const operationError = Object.assign(new Error('injected evidence opening failure'), { code: 'ERR_FIXTURE_OPEN' });
    const trackedOpen = fs.open;
    fs.open = async (...args) => {
      const handle = await trackedOpen(...args);
      if (String(args[0]) === evidencePath) handle.stat = async () => { throw operationError; };
      return handle;
    };
    await assert.rejects(openRuntimeQueryFamily({ destination: options.destination, generationId: imported.pointer.generationId }), error => {
      assert.equal(error.code, operationError.code); assert.equal(error.cause, operationError);
      assert.deepEqual(error.cleanupErrors, [closeError]); return true;
    });
    assert.equal(handles.size, 0, 'all FDs close when open failure and native cleanup failure coincide');
  } finally {
    fs.open = open;
    if (prototype) prototype.close = prototypeClose;
    if (failedDatabase?.open) prototypeClose.call(failedDatabase);
    await Promise.allSettled([...handles].map(handle => handle.close()));
  }
  console.log('Runtime replacement/growth/symlink/cancellation fail closed on opened bytes; paging records actual verification work');
} finally { await fixture.cleanup(); }
