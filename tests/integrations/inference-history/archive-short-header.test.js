import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { visitChatGptExport } from '../../../src/integrations/inference-history/archive.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'history-header-'));
const original = fs.open;
try {
  const zip = new AdmZip(); zip.addFile('conversations.json', Buffer.from('[{"id":"fixture"}]'));
  const file = path.join(root, 'fixture.zip'); await fs.writeFile(file, zip.toBuffer());
  fs.open = async (...args) => {
    const handle = await original(...args), read = handle.read.bind(handle);
    handle.read = (buffer, offset, length, position) => read(buffer, offset, Math.min(1, length), position);
    return handle;
  };
  const records = [];
  await visitChatGptExport({ sourcePath: file, onRecord: record => records.push(record), onMember: () => {} });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'fixture');
} finally { fs.open = original; await fs.rm(root, { recursive: true, force: true }); }
console.log('ZIP detection completes positive short reads before format dispatch.');
