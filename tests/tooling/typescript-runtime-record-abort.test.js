import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runTypeScriptProviderSubprocess } from '../../src/index/tooling/typescript/runtime/index.js';
import { getTrackedSubprocessCount } from '../../src/shared/subprocess/tracking.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('typescript-runtime-record-abort');
try {
  await fs.writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noLib: true, types: [] }, files: ['input.ts'] }));
  const text = 'export function actual(value: number) { return value; }';
  await fs.writeFile(path.join(root, 'input.ts'), text);
  const controller = new AbortController(), reason = Object.freeze(new Error('logger cancelled this invocation'));
  let logObserved = false, callbacksAfterCancellation = 0;
  const inputs = { documents: [{ containerPath: 'input.ts', virtualPath: '.vfs/input.ts', effectiveExt: '.ts', languageId: 'typescript', text }],
    targets: [{ virtualPath: '.vfs/input.ts', virtualRange: { start: 0, end: text.length },
      chunkRef: { chunkUid: 'ck:record-abort', chunkId: 'record-abort', file: 'input.ts', start: 0, end: text.length },
      symbolHint: { name: 'actual', kind: 'function' } }] };
  await assert.rejects(runTypeScriptProviderSubprocess({ repoRoot: root, strict: true,
    toolingConfig: { typescript: { resolveOrder: ['global'] } }, logger: event => {
      if (event.message.includes('phase=checker:start')) { logObserved = true; controller.abort(reason); }
    } }, inputs,
  { signal: controller.signal, timeoutMs: 5000, ownershipId: 'ts-runtime-record-abort', onRecord: async () => {
    if (controller.signal.aborted) { callbacksAfterCancellation++; throw new Error('consumer must not be admitted after logger cancellation'); }
  } }), error => error.name === 'AbortError' && error.code === 'ABORT_ERR' && error.cause === reason);
  assert.equal(logObserved, true, 'the real protocol assembler observes a child log before cancellation');
  assert.equal(callbacksAfterCancellation, 0);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(getTrackedSubprocessCount('ts-runtime-record-abort'), 0, 'the original owned provider child is reaped');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('TypeScript runtime fences deferred record callbacks after real logger cancellation');
