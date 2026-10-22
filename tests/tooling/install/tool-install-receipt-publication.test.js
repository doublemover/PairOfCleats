#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { buildToolInstallReceipt, readToolInstallReceipts, verifyToolInstallReceipt, writeToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';

// UNVALIDATED: authored actual-owner regression; no installer or executable runs.
const suite = path.join(process.cwd(), '.tmp', 'tasks', 'tool-install-receipt-publication');
await fsp.mkdir(suite, { recursive: true });
const root = await fsp.mkdtemp(path.join(suite, 'case-'));
const reseal = value => {
  const { receiptId, ...body } = value;
  return { ...body, receiptId: createHash('sha256').update(stableStringify(body)).digest('hex') };
};
try {
  const consumer = path.join(root, 'inert-consumer');
  await fsp.writeFile(consumer, 'receipt fixture bytes; never executed');
  const result = { path: consumer, probe: { ok: true } };
  const receipt = buildToolInstallReceipt({ tool: { id: 'receipt-fixture' }, toolingRoot: root, result,
    action: { cmd: 'npm', args: ['receipt-fixture@1.2.3'], scope: 'cache' } });
  assert.equal(receipt.source.immutable, false, 'a version-shaped argument does not identify transitive source integrity');
  const managed = buildToolInstallReceipt({ tool: { id: 'managed-fixture' }, toolingRoot: root, result,
    action: { kind: 'immutable-managed-archive', descriptor: { descriptorId: 'separate-owner' }, scope: 'cache' } });
  assert.equal(managed.source.recipe, null, 'an archive descriptor action is not a package-manager command recipe');
  writeToolInstallReceipt(root, managed);
  const target = writeToolInstallReceipt(root, receipt);
  const before = await fsp.stat(target, { bigint: true });
  const bytes = await fsp.readFile(target);
  assert.equal(writeToolInstallReceipt(root, receipt), target);
  const after = await fsp.stat(target, { bigint: true });
  assert.equal(after.ino, before.ino, 'repeat publication preserves the existing evidence object');
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.deepEqual(await fsp.readFile(target), bytes);
  assert.equal(readToolInstallReceipts(root, receipt.toolId).length, 1);

  const unknown = reseal({ ...receipt, pinned: true });
  const unknownBytes = Buffer.from(JSON.stringify(unknown) + '\n');
  await fsp.writeFile(target, unknownBytes);
  assert.throws(() => writeToolInstallReceipt(root, receipt), { code: 'ERR_TOOL_INSTALL_RECEIPT' });
  assert.deepEqual(await fsp.readFile(target), unknownBytes, 'conflicting unknown retention metadata is never replaced');
  const unknownTarget = path.join(path.dirname(target), unknown.receiptId + '.json');
  await fsp.rename(target, unknownTarget);
  assert.throws(() => readToolInstallReceipts(root, receipt.toolId), { code: 'ERR_TOOL_INSTALL_RECEIPT' });
  assert.equal(verifyToolInstallReceipt(unknown).state, 'repair-required', 'a valid body digest does not register unknown metadata');
  assert.throws(() => writeToolInstallReceipt(root, unknown), { code: 'ERR_TOOL_INSTALL_RECEIPT' });
  await fsp.rm(unknownTarget);

  const sourceUnknown = reseal({ ...receipt, source: { ...receipt.source, pinned: true } });
  assert.equal(verifyToolInstallReceipt(sourceUnknown).problems[0].code, 'ERR_TOOL_INSTALL_RECEIPT');
  assert.throws(() => writeToolInstallReceipt(root, { ...receipt, receiptId: '../outside' }), { code: 'ERR_TOOL_INSTALL_RECEIPT' });
  assert.equal(fs.existsSync(path.join(root, 'outside.json')), false);
  assert.throws(() => writeToolInstallReceipt(root, { ...receipt, toolId: 'a'.repeat(102) }), { code: 'ERR_TOOL_INSTALL_RECEIPT' });
  assert.equal(fs.existsSync(path.join(root, 'install-receipts', 'a'.repeat(102))), false);

  const primary = Object.freeze(Object.assign(new Error('exclusive publication denied'), { code: 'EACCES' }));
  const cleanup = new Error('private temporary cleanup denied');
  const link = fs.linkSync, remove = fs.rmSync;
  try {
    fs.linkSync = () => { throw primary; };
    fs.rmSync = targetPath => {
      if (path.dirname(targetPath) === path.dirname(target)) throw cleanup;
      return remove(targetPath);
    };
    assert.throws(() => writeToolInstallReceipt(root, receipt), error => error.cause === primary
      && error.errors[0] === primary && error.errors[1] === cleanup);
  } finally { fs.linkSync = link; fs.rmSync = remove; }
  writeToolInstallReceipt(root, receipt);

  const openDirectory = fs.opendirSync;
  let visited = 0, closed = false;
  try {
    fs.opendirSync = directory => directory === path.dirname(target) ? {
      readSync: () => ({ name: `unregistered-${++visited}` }),
      closeSync: () => { closed = true; }
    } : openDirectory(directory);
    assert.throws(() => readToolInstallReceipts(root, receipt.toolId), /entry bound/);
    assert.equal(visited, 4097, 'unregistered entries also consume the real reader inventory allowance');
    assert.equal(closed, true, 'bounded inventory closes its actual directory owner on refusal');
  } finally { fs.opendirSync = openDirectory; }
  assert.deepEqual(await fsp.readFile(target), bytes);
} finally { await fsp.rm(root, { recursive: true, force: true }); }
console.log('Tool receipt publication preserves existing evidence and rejects unknown producer metadata.');
