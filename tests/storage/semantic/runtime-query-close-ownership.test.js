import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { openRuntimeQueryFamily } from '../../../src/index/semantic/runtime/query-store.js';

// Portable cleanup controls transferred from runtime-opened-byte-integrity.
// Physical-link authority remains in that independently scheduled fixture.
const fixture = await createRuntimeImportFixture();
try {
  const options = fixture.options(), imported = await importRuntimeEvidence(options);
  const root = await fs.realpath(path.join(options.destination, 'generations', imported.pointer.generationId));
  const evidencePath = path.join(root, 'evidence.jsonl');
  const open = fs.open, handles = new Set();
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
      assert.equal(error.code, operationError.code);
      assert.equal(error.operationError, operationError, 'retain the exact operation failure across nested cleanup context');
      assert.deepEqual(error.cleanupErrors, [closeError]); return true;
    });
    assert.equal(handles.size, 0, 'all FDs close when open failure and native cleanup failure coincide');
  } finally {
    fs.open = open;
    if (prototype) prototype.close = prototypeClose;
    if (failedDatabase?.open) prototypeClose.call(failedDatabase);
    await Promise.allSettled([...handles].map(handle => handle.close()));
  }
  console.log('Runtime query failures retain original operation and independent cleanup owners');
} finally { await fixture.cleanup(); }
