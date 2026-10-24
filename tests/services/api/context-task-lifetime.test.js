import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { assembleCompositeContextPack } from '../../../src/context-pack/assemble.js';
import { createContextPackValidator } from '../../../tools/api/validation.js';
import { getContainedFileSession } from '../../../src/shared/contained-file.js';

const key = Symbol.for('poc.context-task-operation');
const hook = registerHooks({ load(url, context, next) {
  if (url.endsWith('/integrations/tooling/context-pack.js')) return { format: 'module', shortCircuit: true,
    source: `export const buildCompositeContextPackPayload=(request,context)=>globalThis[Symbol.for('poc.context-task-operation')](request,context);` };
  return next(url, context);
} });
const { handleContextPackRoute } = await import('../../../tools/api/router/analysis.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-context-task-http-'));
const file = path.join(root, 'source.js'), text = '\tfunction original() { return "界"; }\r\n';
fs.writeFileSync(file, text);
const request = { repoPath: root, seed: 'chunk:seed', hops: 0, includeGraph: false,
  taskPolicy: { schemaVersion: 1, task: 'edit-safe', granularity: 'file' } };
const originalOpen = fs.openSync, originalClose = fs.closeSync, originalRead = fs.readSync;
let held = null, deny = true, reads = 0, closes = 0;
try {
  for (const seam of ['body', 'repository', 'operation']) {
    const req = new EventEmitter(), res = new EventEmitter(); let calls = 0, writes = 0;
    res.writeHead = () => { writes++; }; res.end = () => { res.writableEnded = true; };
    const disconnect = () => { res.destroyed = true; res.emit('close'); };
    globalThis[key] = (_request, context) => {
      calls++;
      return assembleCompositeContextPack({ repoRoot: root, seed: { type: 'chunk', chunkUid: 'seed' },
        chunkMeta: [{ file: 'source.js', chunkUid: 'seed', fileHash: createHash('sha1').update(text).digest('hex') }],
        taskPolicy: _request.taskPolicy, indexSignature: 'retained-http-edit', includeGraph: false, signal: context.signal });
    };
    if (seam === 'operation') {
      fs.openSync = (target, ...args) => { const fd = originalOpen(target, ...args); if (path.resolve(String(target)) === file) held = fd; return fd; };
      fs.readSync = (fd, ...args) => { const result = originalRead(fd, ...args); if (fd === held) { reads++; disconnect(); } return result; };
      fs.closeSync = fd => { if (fd === held) { closes++; if (deny) throw new Error('original source close failed'); } return originalClose(fd); };
    }
    const run = () => handleContextPackRoute({ req, res, validateContextPackPayload: createContextPackValidator(),
      parseJsonBody: async () => { if (seam === 'body') disconnect(); return request; },
      resolveRepo: async () => { if (seam === 'repository') disconnect(); return root; } });
    if (seam === 'operation') {
      let failure; try { await run(); assert.fail('must retain the original pending source descriptor'); } catch (error) { failure = error; }
      assert.equal(failure.cacheOwnershipReleased(), false); assert.equal(closes, 1);
      deny = false;
      assert.throws(() => getContainedFileSession(failure).releaseAfterCloseSync());
      assert.equal(failure.cacheOwnershipReleased(), false, 'an ambiguous synchronous native close cannot be retried by a reusable fd number');
      assert.equal(closes, 1); assert.equal(reads, 1);
      // The harness knows its injected close threw before touching this exact
      // real descriptor. Physical fixture cleanup is independent of production
      // retirement and cannot manufacture a settled ownership receipt.
      originalClose(held); held = null;
    } else await run();
    assert.equal(calls, seam === 'operation' ? 1 : 0); assert.equal(writes, 0);
    for (const [surface, event] of [[req, 'aborted'], [req, 'error'], [res, 'close'], [res, 'error']]) assert.equal(surface.listenerCount(event), 0);
  }
} finally {
  hook.deregister(); delete globalThis[key]; fs.openSync = originalOpen; fs.closeSync = originalClose; fs.readSync = originalRead;
  if (held !== null) { try { originalClose(held); } catch {} }
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('The actual context-pack HTTP adapter cancels preparation and retains original edit-source cleanup ownership.');
