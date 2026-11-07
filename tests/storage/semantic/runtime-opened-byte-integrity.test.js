import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
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
    const controller = new AbortController(), originalOpen = fs.open, originalLstat = fsSync.lstatSync;
    const outside = path.join(fixture.root, 'outside.json');
    const handles = new Set();
    let injected = false, reparseChecks = 0, memberOpens = 0;
    // Exercise the actual no-follow authority check without requiring OS link
    // privileges. Ordinary-file mutation/growth below still use real handles.
    fsSync.lstatSync = function (filename, ...args) {
      const stat = originalLstat.call(this, filename, ...args);
      if (mode === 'symlink' && path.resolve(String(filename)) === capturePath) {
        reparseChecks++;
        return new Proxy(stat, { get(value, key) { return key === 'isSymbolicLink' ? () => true : Reflect.get(value, key); } });
      }
      return stat;
    };
    fs.open = async (...args) => {
      const handle = await originalOpen(...args), originalClose = handle.close.bind(handle);
      handles.add(handle);
      handle.close = async () => { try { return await originalClose(); } finally { handles.delete(handle); } };
      if (String(args[0]) === capturePath) {
        memberOpens++;
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
            else controller.abort();
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
      assert.equal(injected, mode !== 'symlink', `${mode}: mutate the actual member, or reject its injected reparse kind before opening`);
      if (mode === 'symlink') { assert.ok(reparseChecks > 0); assert.equal(memberOpens, 0); }
      assert.equal(handles.size, 0, 'all opened members close on integrity or cancellation failure');
    } finally {
      fs.open = originalOpen; fsSync.lstatSync = originalLstat;
      await fs.writeFile(capturePath, original);
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
  {
    const authorityLink = path.join(root, 'evidence-authority-link'), lstat = fsSync.lstatSync, open = fs.open;
    const stat = lstat(evidencePath); let inspected = 0, opened = 0;
    fsSync.lstatSync = function (filename, ...args) {
      if (path.resolve(String(filename)) === authorityLink) {
        inspected++;
        return new Proxy(stat, { get(value, key) { return key === 'isSymbolicLink' ? () => true : Reflect.get(value, key); } });
      }
      return lstat.call(this, filename, ...args);
    };
    fs.open = (...args) => { if (String(args[0]) === authorityLink) opened++; return open(...args); };
    try {
      await assert.rejects(openVerifiedRuntimeMember({ root, relativePath: 'evidence-authority-link',
        expectedHash: manifest.evidence.hash, expectedBytes: manifest.evidence.byteLength,
        maxBytes: 1024 * 1024 }), { code: 'ERR_RUNTIME_IMPORT_INTEGRITY' });
      assert.ok(inspected > 0); assert.equal(opened, 0);
    } finally { fsSync.lstatSync = lstat; fs.open = open; }
  }
  const open = fs.open, lstat = fsSync.lstatSync, handles = new Set();
  let switched = false, finalReparseChecks = 0;
  fsSync.lstatSync = function (filename, ...args) {
    const stat = lstat.call(this, filename, ...args);
    if (switched && path.resolve(String(filename)) === evidencePath) {
      finalReparseChecks++;
      return new Proxy(stat, { get(value, key) { return key === 'isSymbolicLink' ? () => true : Reflect.get(value, key); } });
    }
    return stat;
  };
  fs.open = async (...args) => {
    const handle = await open(...args), close = handle.close.bind(handle);
    handles.add(handle); handle.close = async () => { try { return await close(); } finally { handles.delete(handle); } };
    if (String(args[0]) === evidencePath) {
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!switched) {
          switched = true;
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
    assert.ok(finalReparseChecks > 0, 'the final contained-handle authority recheck observes the injected reparse kind');
    assert.equal(handles.size, 0, 'streaming integrity failure closes the original owned descriptor');
  } finally {
    fs.open = open; fsSync.lstatSync = lstat;
    assert.deepEqual(await fs.readFile(evidencePath), evidenceOriginal, 'portable reparse-kind injection does not mutate retained evidence');
  }

  console.log('Runtime real-file replacement/growth/cancellation and portable pre-open/post-read reparse-kind authority boundaries fail closed; no native symlink capability claim.');
} finally { await fixture.cleanup(); }
