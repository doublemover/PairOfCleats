import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { setImmediate as tick } from 'node:timers/promises';
import { importRuntimeEvidence } from '../../../src/index/semantic/runtime/import.js';
import { writeRuntimeQueryIndex } from '../../../src/index/semantic/runtime/query-index.js';
import { createRuntimeImportFixture } from '../../helpers/runtime-import-fixture.js';

const fixture = await createRuntimeImportFixture();
const originalStream = fsSync.createReadStream, originalOpen = fs.open;
let release;
const gate = new Promise(resolve => { release = resolve; });
let closeRequested = false, completed = false, operation;
try {
  const imported = await importRuntimeEvidence(fixture.options());
  const source = path.join(fixture.options().destination, 'generations', imported.pointer.generationId);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  const root = path.join(fixture.root, 'hash-close'); await fs.mkdir(root);
  await fs.copyFile(path.join(source, 'evidence.jsonl'), path.join(root, 'evidence.jsonl'));
  const filename = path.join(root, 'query.sqlite');
  const hold = action => { closeRequested = true; return gate.then(action); };
  fsSync.createReadStream = (file, options) => String(file) !== filename ? originalStream(file, options)
    : originalStream(file, { ...options, fs: { ...fsSync,
      close(fd, callback) { void hold(() => fsSync.close(fd, callback)); } } });
  syncBuiltinESMExports();
  fs.open = async (file, flags, ...args) => {
    const handle = await originalOpen(file, flags, ...args);
    if (String(file) === filename && flags === 'r') {
      const close = handle.close.bind(handle);
      handle.close = () => hold(close);
    }
    return handle;
  };
  operation = writeRuntimeQueryIndex({ root, evidence: manifest.evidence, capture: imported.capture,
    reserve: async () => {}, release: () => {} }).then(value => { completed = true; return value; });
  for (let count = 0; count < 1000 && !closeRequested; count++) await tick();
  assert.equal(closeRequested, true, 'exercise the actual final hash descriptor close');
  await tick();
  assert.equal(completed, false, 'query-index publication cannot precede its original hash descriptor close');
  release(); const result = await operation;
  assert.equal(result.byteLength, (await fs.stat(filename)).size);
  assert.equal(result.hash, (await import('node:crypto')).createHash('sha256').update(await fs.readFile(filename)).digest('hex'));
} finally {
  release(); await operation?.catch(() => {});
  fs.open = originalOpen; fsSync.createReadStream = originalStream; syncBuiltinESMExports();
  await fixture.cleanup();
}
