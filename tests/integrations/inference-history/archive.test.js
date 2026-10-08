import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { normalizeMemberLinks } from '../../../src/integrations/inference-history/member-links.js';
import { visitChatGptExport } from '../../../src/integrations/inference-history/archive.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await makeTempDir('poc-history-archive-');
const file = path.join(root, 'synthetic.zip');
const sample = [{ id: 'one', mapping: {}, title: 'a quote " and bracket }' }];
const json = strToU8(JSON.stringify(sample));
const rows = [];
const members = [];
const read = (options = {}) => visitChatGptExport({ sourcePath: file,
  onRecord: (value, locator) => rows.push({ value, locator }), onMember: (member) => members.push(member), ...options });
try {
  await fs.writeFile(file, zipSync({ 'conversations-001.json': json, 'nested/conversations_002.json': json,
    'assets/photo.dat': new Uint8Array([1, 2, 3]) }));
  const result = await read();
  assert.equal(result.conversations, 2);
  assert.equal(result.members, 3);
  assert.equal(result.complete, true);
  assert.deepEqual(rows.map((row) => row.value), [...sample, ...sample]);
  assert.equal(rows[0].locator.ordinal, 0);
  assert.equal(rows[0].locator.raw, JSON.stringify(sample[0]));
  assert.equal(members.find((member) => member.name === 'assets/photo.dat').bytes, 3);
  assert.match(members[0].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual((await fs.readdir(root)).sort(), ['synthetic.zip']);

  await fs.writeFile(file, zipSync({ 'conversations.json': json, 'assets.zip': new Uint8Array([0]) }));
  const partial = await read();
  assert.equal(partial.complete, false);
  assert.equal(partial.unsupportedArchives, 1);

  for (const entries of [
    { '../conversations.json': json },
    { '/conversations.json': json },
    { 'C:/conversations.json': json },
    { 'a\\conversations.json': json },
    { 'conversations.json': json, 'Conversations.json': json }
  ]) {
    await fs.writeFile(file, zipSync(entries));
    await assert.rejects(read(), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  }
  await fs.writeFile(file, zipSync({ 'conversations.json': json, 'other': new Uint8Array(1024) }));
  await assert.rejects(read({ limits: { maxMemberBytes: 512 } }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
  await assert.rejects(read({ limits: { maxEntries: 1 } }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
  await assert.rejects(read({ limits: { maxConversationBytes: 8 } }), { code: 'ERR_INFERENCE_HISTORY_LIMIT' });
  await assert.rejects(read({ signal: AbortSignal.abort() }), { code: 'ERR_INFERENCE_HISTORY_ABORTED' });

  const metadata = [];
  await fs.writeFile(file, zipSync({ 'codex.json': strToU8('[{"id":"task"}]'),
    'export_manifest.json': strToU8('{"export_files":[],"logical_files":{}}') }));
  const taskResult = await read({ onMetadata: row => metadata.push(row) });
  assert.equal(taskResult.tasks, 1);
  assert.equal(taskResult.conversations, 0);
  assert.equal(rows.at(-1).locator.evidenceKind, 'exported_codex_task');
  assert.equal(metadata[0].kind, 'export_manifest');
  assert.deepEqual(normalizeMemberLinks({ export_files: [{ path: 'a.dat', size_bytes: 3 }],
    logical_files: { asset: { files: ['a.dat'], sharded: false } } }, 'export_manifest',
  'export/export_manifest.json', 8).map(link => link.memberPath), ['export/a.dat', 'export/a.dat']);
  assert.throws(() => normalizeMemberLinks({ '../bad': 'label' }, 'asset_names', 'names.json', 8),
    { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  assert.throws(() => normalizeMemberLinks({ 'a.dat': 'label' }, 'asset_names', 'names.json', 0),
    { code: 'ERR_INFERENCE_HISTORY_LIMIT' });

  const corrupted = Buffer.from(zipSync({ 'conversations.json': json }));
  const central = corrupted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupted.writeUInt32LE(123, central + 16);
  await fs.writeFile(file, corrupted);
  await assert.rejects(read(), { code: 'ERR_INFERENCE_HISTORY_INPUT' });

  for (const malformed of ['[{},]', '[{} {}]', '[{}]suffix', '{"mapping":{}}', '[{}', '[', '[]', '[\u00a0{}]', '[\v{}]']) {
    await fs.writeFile(file, malformed);
    await assert.rejects(read(), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  }
  await fs.writeFile(file, JSON.stringify(sample));
  assert.equal((await read()).conversations, 1);
  await fs.writeFile(file, Buffer.from([0x5b, 0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d, 0x5d]));
  await assert.rejects(read(), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  console.log('Inference history bounded archive parsing, inventory, CRC and unsafe paths passed.');
} finally { await rmDirRecursive(root); }
