import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';
import { importRuntimeEvidence, verifyRuntimeFamily } from '../../../src/index/semantic/runtime/import.js';
import { queryRuntimeEvidence, defaultRuntimeQuerySelectors } from '../../../src/index/semantic/runtime/query.js';
import { openVerifiedRuntimeMember } from '../../../src/index/semantic/runtime/verified-reads.js';

const fixture = await createRuntimeImportFixture();
try {
  const options = fixture.options(), imported = await importRuntimeEvidence(options);
  const manifest = (await verifyRuntimeFamily({ destination: options.destination, pointer: imported.pointer })).manifest;
  // Query-family admission opens canonical paths, including expanded Windows
  // DOS temp aliases. Fault hooks must target that actual opened spelling.
  const root = await fs.realpath(path.join(options.destination, 'generations', imported.pointer.generationId));
  const capturePath = path.join(root, 'capture.json'), original = await fs.readFile(capturePath);
  const request = { schemaVersion: 1, repositoryNamespace: fixture.capture.repositoryNamespace, generation: fixture.capture.generation,
    familyGenerations: [imported.pointer.generationId], selectors: defaultRuntimeQuerySelectors(),
    limits: { maxRecords: 1, maxBytes: 65536, maxMs: 1000 }, cursor: null };
  for (const mode of ['replacement', 'growth', 'symlink', 'cancellation']) {
    const controller = new AbortController(), originalOpen = fs.open;
    const outside = path.join(fixture.root, 'outside.json'), backup = path.join(root, 'capture.backup');
    const handles = new Set();
    let injected = false;
    if (mode === 'symlink' && process.platform === 'win32') {
      // Windows will not rename an opened member. Check the real file-symlink
      // authority boundary before opening it; Unix exercises the live swap below.
      await fs.writeFile(outside, original);
      await fs.rename(capturePath, backup);
      await fs.symlink(outside, capturePath);
    }
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
              if (process.platform === 'win32') {
                // Mutate the same opened object at fixed length under Windows
                // sharing rules, retaining the post-read integrity assertion.
                const writer = await originalOpen(capturePath, 'r+');
                try { await writer.write(Buffer.from([0x20]), 0, 1, 0); } finally { await writer.close(); }
              } else {
                await fs.writeFile(outside, original); await fs.rename(outside, capturePath);
              }
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
        mode === 'cancellation' ? { code: 'ABORT_ERR' } : { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' },
        `${mode}: the real opened-member control must reject`);
      assert.equal(injected, !(mode === 'symlink' && process.platform === 'win32'),
        `${mode}: mutate the actual member, or reject the Windows symlink before its read`);
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
  const evidenceOriginal = await fs.readFile(evidencePath);
  const retainedPath = path.join(root, 'retained-evidence');
  if (process.platform === 'win32') {
    const authorityLink = path.join(root, 'evidence-authority-link');
    const outsideEvidence = path.join(fixture.root, 'outside-evidence');
    await fs.writeFile(outsideEvidence, evidenceOriginal);
    await fs.symlink(outsideEvidence, authorityLink);
    try {
      await assert.rejects(openVerifiedRuntimeMember({ root, relativePath: 'evidence-authority-link',
        expectedHash: manifest.evidence.hash, expectedBytes: manifest.evidence.byteLength,
        maxBytes: 1024 * 1024 }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
    } finally { await fs.unlink(authorityLink); await fs.unlink(outsideEvidence); }
  }
  const open = fs.open, handles = new Set();
  let switched = false;
  fs.open = async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    handles.add(handle); handle.close = async () => { try { return await close(); } finally { handles.delete(handle); } };
    if (String(args[0]) === evidencePath) {
      const before = await handle.stat(), read = handle.read.bind(handle);
      // Unix isolates the containment recheck from timestamp changes while
      // preserving a real same-inode swap. Windows tests live byte mutation.
      if (process.platform !== 'win32') handle.stat = async () => before;
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!switched) {
          switched = true;
          if (process.platform === 'win32') {
            const writer = await open(evidencePath, 'r+');
            try { await writer.write(Buffer.from([0x20]), 0, 1, 0); } finally { await writer.close(); }
          } else {
            await fs.rename(evidencePath, retainedPath);
            await fs.symlink(retainedPath, evidencePath);
          }
        }
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
    assert.equal(handles.size, 0, 'streaming integrity failure closes the original owned descriptor');
  } finally {
    fs.open = open;
    if (switched) {
      if (process.platform === 'win32') await fs.writeFile(evidencePath, evidenceOriginal);
      else { await fs.unlink(evidencePath); await fs.rename(retainedPath, evidencePath); }
    }
  }

  console.log('Runtime replacement/growth/symlink/cancellation fail closed on opened bytes; paging records actual verification work');
} finally { await fixture.cleanup(); }
